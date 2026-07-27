import type { Pipeline } from "cloudflare:pipelines";
import type { Restriction } from "./src/arcgis";
import { fetchDetours, fetchRestrictions, fetchVmsSigns, fetchWeatherReadings } from "./src/arcgis";
import {
  pruneWeatherHistory,
  upsertCameras,
  upsertDetours,
  upsertHazardsAndGetChanged,
  upsertRestrictions,
  upsertVmsSigns,
  upsertWeatherHistory,
  upsertWeatherReadings,
} from "./src/db";
import { log, sendToStream } from "./src/log";
import { notifyMatchingSavedPoints, type PushBudget } from "./src/notify";
import type { HazardRecord } from "./src/tarktee";
import { fetchAllHazards, fetchCamerasMetadata } from "./src/tarktee";

interface Env {
  DB: D1Database;
  AI: Ai;
  // DATEX II API key, active — set via `wrangler secret put TARKTEE_API_KEY`.
  TARKTEE_API_KEY?: string;
  // Not secret — see wrangler.toml's [vars] comment.
  VAPID_PUBLIC_KEY: string;
  // Real secret, set via `wrangler secret put VAPID_PRIVATE_KEY` — absent until that's done,
  // in which case push sending is skipped entirely (see notify.ts).
  VAPID_PRIVATE_KEY?: string;
  // Long-term operational log export — see src/log.ts.
  LOG_STREAM: Pipeline;
}

const WEATHER_HISTORY_RETENTION_DAYS = 7;

// Two cron schedules (wrangler.toml), dispatched by pattern. Originally split to fix a D1
// write-quota blowout (569k/day at every-2-min-for-everything) by moving restrictions/cameras
// to a slower cadence — but that traded write volume for staleness (a brand new closure could
// take up to 30 minutes to appear). Fixed properly instead: upsertRestrictions/upsertDetours
// now diff against what's already stored and only write rows that actually changed, so their
// write cost tracks real-world change frequency rather than poll frequency — safe to move back
// onto the fast cadence. cameras stays slow; camera locations essentially never change and
// there's no freshness reason to poll them as often as restrictions/weather.
const FAST_CRON = "*/3 * * * *";
const SLOW_CRON = "*/30 * * * *";

export default {
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    if (controller.cron === FAST_CRON) {
      ctx.waitUntil(pollFast(env));
    } else if (controller.cron === SLOW_CRON) {
      ctx.waitUntil(pollSlow(env));
    }
  },
} satisfies ExportedHandler<Env>;

interface StepOutcome {
  ok: boolean;
  error?: string;
  // Whatever cheap detail the step itself has on hand (record counts, per-feed breakdowns) —
  // folded into the persisted cycle summary so it's useful for trend analysis later, not just
  // pass/fail. See individual runStep call sites in pollFast/pollSlow for what each contributes.
  [key: string]: unknown;
}

// Each step is isolated — one feed failing (e.g. a malformed response, a transient Tark Tee
// error) must not prevent the others from running. Confirmed this was a real bug, not a
// theoretical one: an empty-array crash in the cameras upsert silently killed hazard
// ingestion too, because everything shared one unguarded async function body.
//
// Returns the step's outcome (rather than void) so the caller can fold it into one persisted
// per-cycle summary — see pollFast/pollSlow — instead of a separate R2 write per step. `step`
// may return a detail object (merged into the outcome) or nothing.
async function runStep(
  env: Env,
  name: string,
  step: () => Promise<Record<string, unknown> | void>,
): Promise<StepOutcome> {
  try {
    const detail = await step();
    return { ok: true, ...detail };
  } catch (err) {
    const message = err instanceof Error ? err.stack ?? err.message : String(err);
    console.error(`[ingest-worker] step "${name}" failed:`, message);
    return { ok: false, error: message };
  }
}

// One persisted event per poll cycle (not one per step) for the same reason tarktee.ts's
// fetchAllHazards consolidated its own per-feed logging — R2 also charges per write operation,
// and a cycle's worth of step outcomes fits comfortably in a single object.
async function persistCycleSummary(
  env: Env,
  cycle: "pollFast" | "pollSlow",
  outcomes: Record<string, StepOutcome>,
): Promise<void> {
  // !o.ok catches a step that threw; o.hasIssue catches one that didn't throw but still hit a
  // partial problem internally (e.g. fetchAllHazards's Promise.allSettled swallows individual
  // feed failures into perFeed rather than throwing) — without checking it too, a single feed
  // erroring would silently stay at INFO instead of surfacing as WARN.
  const hasFailure = Object.values(outcomes).some((o) => !o.ok || o.hasIssue);
  const entry = log(hasFailure ? "WARN" : "INFO", cycle, { steps: outcomes });
  await sendToStream(env.LOG_STREAM, entry);
}

// How many Web Push sends notifyMatchingSavedPoints is willing to make in one poll cycle —
// same shape/reasoning as translate.ts's TranslationBudget. Push matching runs as the very
// last step in pollFast, after weather (~1 request), hazards (up to ~7 in parallel),
// restrictions (~1-2), detours (~1-2), vms (~3), and translation (up to 20) have already spent
// their share of the Workers Free plan's 50-subrequest-per-invocation ceiling — this is
// deliberately conservative about what's likely left over, not a precise remaining-budget
// calculation (Workers doesn't expose one). Any sends that don't fit just retry next cycle (3
// minutes later), gated by notified_at staying unset — see notify.ts.
const MAX_PUSH_SENDS_PER_CYCLE = 15;

async function pollFast(env: Env): Promise<void> {
  let changedHazards: HazardRecord[] = [];
  let changedRestrictions: Restriction[] = [];
  const outcomes: Record<string, StepOutcome> = {};

  outcomes.weatherReadings = await runStep(env, "weatherReadings", async () => {
    const readings = await fetchWeatherReadings();
    await upsertWeatherReadings(env.DB, readings);
    // Once-per-hour insert (INSERT OR IGNORE, not an upsert) — writing on every 3-min poll was
    // the single biggest contributor to the D1 write overage: 30x more writes than an hourly
    // snapshot actually needs, for a table whose whole point is hourly granularity.
    await upsertWeatherHistory(env.DB, readings, currentHourBucket());
    await pruneWeatherHistory(env.DB, WEATHER_HISTORY_RETENTION_DAYS);
    return { stations: readings.length };
  });

  outcomes.hazards = await runStep(env, "hazards", async () => {
    // Skip entirely rather than fetch (which returns [] per feed type until TARKTEE_API_KEY
    // is active — registration pending) — upsertHazardsAndGetChanged treats an empty input as
    // "confirmed zero hazards" and deletes every existing row accordingly. Without this guard,
    // any hazard row that ever existed would get wiped on the very next poll while the key is
    // unset, since there'd be nothing to distinguish "genuinely zero" from "didn't really fetch".
    if (!env.TARKTEE_API_KEY) return;
    const { records, perFeed, hasIssue } = await fetchAllHazards(env.TARKTEE_API_KEY);
    changedHazards = await upsertHazardsAndGetChanged(env.DB, records);
    return { changed: changedHazards.length, perFeed, hasIssue };
  });

  outcomes.restrictions = await runStep(env, "restrictions", async () => {
    const restrictions = await fetchRestrictions();
    changedRestrictions = await upsertRestrictions(env.DB, env.AI, restrictions);
    return { total: restrictions.length, changed: changedRestrictions.length };
  });

  outcomes.detours = await runStep(env, "detours", async () => {
    const detours = await fetchDetours();
    await upsertDetours(env.DB, detours);
    return { total: detours.length };
  });

  outcomes.vms = await runStep(env, "vms", async () => {
    const signs = await fetchVmsSigns();
    await upsertVmsSigns(env.DB, signs);
    return { total: signs.length };
  });

  // Last step, deliberately — see MAX_PUSH_SENDS_PER_CYCLE.
  outcomes.pushNotifications = await runStep(env, "pushNotifications", async () => {
    const vapidKeys = env.VAPID_PRIVATE_KEY
      ? { publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY }
      : null;
    const budget: PushBudget = { remaining: MAX_PUSH_SENDS_PER_CYCLE };
    await notifyMatchingSavedPoints(env.DB, vapidKeys, changedHazards, changedRestrictions, budget);
    // budget.remaining is decremented per actual send (see notify.ts) — the difference from
    // the starting allowance is how many pushes this cycle actually sent, without needing to
    // change notifyMatchingSavedPoints's own signature just to report a count.
    return { sent: MAX_PUSH_SENDS_PER_CYCLE - budget.remaining };
  });

  await persistCycleSummary(env, "pollFast", outcomes);
}

async function pollSlow(env: Env): Promise<void> {
  const outcomes: Record<string, StepOutcome> = {};

  outcomes.cameras = await runStep(env, "cameras", async () => {
    const cameras = await fetchCamerasMetadata();
    await upsertCameras(env.DB, cameras);
    return { total: cameras.length };
  });

  await persistCycleSummary(env, "pollSlow", outcomes);
}

// Truncated to the hour, UTC — matches the granularity weather_station_history stores at
// (one row per station per hour, see db.ts's upsertWeatherHistory).
function currentHourBucket(): string {
  const d = new Date();
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString();
}
