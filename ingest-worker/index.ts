import { fetchAllHazards, fetchCamerasMetadata } from "./src/tarktee";
import { fetchRestrictions, fetchWeatherReadings } from "./src/arcgis";
import {
  pruneWeatherHistory,
  upsertCameras,
  upsertHazardsAndGetChanged,
  upsertRestrictions,
  upsertWeatherHistory,
  upsertWeatherReadings,
} from "./src/db";

interface Env {
  DB: D1Database;
  // DATEX II API key, active — set via `wrangler secret put TARKTEE_API_KEY`.
  TARKTEE_API_KEY?: string;
}

const WEATHER_HISTORY_RETENTION_DAYS = 7;

// Two cron schedules (wrangler.toml), dispatched by pattern. Split after confirming D1's free
// 100k-writes/day quota was being blown ~5.7x over (569k/day at the old every-2-min-for-
// everything cadence) — weather/hazards benefit from staying fresh, restrictions/cameras
// don't change minute to minute and were the majority of the waste.
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
}

async function pollSlow(env: Env): Promise<void> {
  await runStep("restrictions", async () => {
    const restrictions = await fetchRestrictions();
    await upsertRestrictions(env.DB, restrictions);
  });

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
