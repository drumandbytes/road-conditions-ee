import { fetchAllHazards, fetchCamerasMetadata, fetchWeatherStationsMetadata, fetchWeatherStationsStatus } from "./src/tarktee";
import { upsertCameras, upsertHazardsAndGetChanged, upsertWeatherStations, upsertWeatherStatus } from "./src/db";

interface Env {
  DB: D1Database;
  // TARKTEE_API_KEY set once the DATEX II registration is approved (Phase 0, task submitted,
  // pending manual Transpordiamet review as of writing) — add via `wrangler secret put`.
  TARKTEE_API_KEY?: string;
}

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
  await runStep("weatherStations", async () => {
    const stations = await fetchWeatherStationsMetadata();
    await upsertWeatherStations(env.DB, stations);
  });

  await runStep("weatherStatus", async () => {
    const statuses = await fetchWeatherStationsStatus();
    await upsertWeatherStatus(env.DB, statuses);
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
