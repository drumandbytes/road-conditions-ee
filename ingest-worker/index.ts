import { fetchAllHazards, fetchCamerasMetadata } from "./src/tarktee";
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

interface Env {
  DB: D1Database;
  AI: Ai;
  // DATEX II API key, active — set via `wrangler secret put TARKTEE_API_KEY`.
  TARKTEE_API_KEY?: string;
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

// Each step is isolated — one feed failing (e.g. a malformed response, a transient Tark Tee
// error) must not prevent the others from running. Confirmed this was a real bug, not a
// theoretical one: an empty-array crash in the cameras upsert silently killed hazard
// ingestion too, because everything shared one unguarded async function body.
async function runStep(name: string, step: () => Promise<void>): Promise<void> {
  try {
    await step();
  } catch (err) {
    console.error(`[ingest-worker] step "${name}" failed:`, err instanceof Error ? err.stack : err);
  }
}

async function pollFast(env: Env): Promise<void> {
  await runStep("weatherReadings", async () => {
    const readings = await fetchWeatherReadings();
    await upsertWeatherReadings(env.DB, readings);
    // Once-per-hour insert (INSERT OR IGNORE, not an upsert) — writing on every 3-min poll was
    // the single biggest contributor to the D1 write overage: 30x more writes than an hourly
    // snapshot actually needs, for a table whose whole point is hourly granularity.
    await upsertWeatherHistory(env.DB, readings, currentHourBucket());
    await pruneWeatherHistory(env.DB, WEATHER_HISTORY_RETENTION_DAYS);
  });

  await runStep("hazards", async () => {
    // Returns [] per feed type until TARKTEE_API_KEY is active (registration pending).
    const hazards = await fetchAllHazards(env.TARKTEE_API_KEY);
    const changedHazards = await upsertHazardsAndGetChanged(env.DB, hazards);

    // Phase 4 work: match changedHazards against saved_points and send Web Push here.
    // Not wired up yet — see src/push.ts.
    if (changedHazards.length > 0) {
      console.log(`${changedHazards.length} new/changed hazards this cycle (push-matching not yet wired up)`);
    }
  });

  await runStep("restrictions", async () => {
    const restrictions = await fetchRestrictions();
    await upsertRestrictions(env.DB, env.AI, restrictions);
  });

  await runStep("detours", async () => {
    const detours = await fetchDetours();
    await upsertDetours(env.DB, detours);
  });

  await runStep("vms", async () => {
    const signs = await fetchVmsSigns();
    await upsertVmsSigns(env.DB, signs);
  });
}

async function pollSlow(env: Env): Promise<void> {
  await runStep("cameras", async () => {
    const cameras = await fetchCamerasMetadata();
    await upsertCameras(env.DB, cameras);
  });
}

// Truncated to the hour, UTC — matches the granularity weather_station_history stores at
// (one row per station per hour, see db.ts's upsertWeatherHistory).
function currentHourBucket(): string {
  const d = new Date();
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString();
}
