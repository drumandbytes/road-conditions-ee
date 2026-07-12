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

// Truncated to the hour, UTC — matches the granularity weather_station_history stores at
// (one row per station per hour, see db.ts's upsertWeatherHistory).
function currentHourBucket(): string {
  const d = new Date();
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString();
}

const WEATHER_HISTORY_RETENTION_DAYS = 7;

export default {
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(pollTarkTee(env));
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

async function pollTarkTee(env: Env): Promise<void> {
  await runStep("weatherReadings", async () => {
    const readings = await fetchWeatherReadings();
    await upsertWeatherReadings(env.DB, readings);
    await upsertWeatherHistory(env.DB, readings, currentHourBucket());
    await pruneWeatherHistory(env.DB, WEATHER_HISTORY_RETENTION_DAYS);
  });

  await runStep("restrictions", async () => {
    const restrictions = await fetchRestrictions();
    await upsertRestrictions(env.DB, restrictions);
  });

  await runStep("cameras", async () => {
    const cameras = await fetchCamerasMetadata();
    await upsertCameras(env.DB, cameras);
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
