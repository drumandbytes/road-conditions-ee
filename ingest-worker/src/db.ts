import type { CameraMeta, HazardRecord, WeatherStationMeta, WeatherStationStatus } from "./tarktee";

// db.batch([]) throws "D1_ERROR: No SQL statements detected" on an empty array — confirmed
// in production (broke the cameras upsert when every entry from the old, broken metadata
// endpoint had null geometry, which silently killed the rest of that poll cycle too). Guard
// every batch call with this rather than relying on callers to never pass an empty list.
async function batchIfNonEmpty(db: D1Database, statements: D1PreparedStatement[]): Promise<void> {
  if (statements.length === 0) return;
  await db.batch(statements);
}

export async function upsertWeatherStations(db: D1Database, stations: WeatherStationMeta[]): Promise<void> {
  const stmt = db.prepare(
    `INSERT INTO weather_stations (id, name, lat, lng) VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, lat = excluded.lat, lng = excluded.lng`,
  );
  await batchIfNonEmpty(db, stations.map((s) => stmt.bind(s.id, s.name, s.lat, s.lng)));
}

export async function upsertWeatherStatus(db: D1Database, statuses: WeatherStationStatus[]): Promise<void> {
  const stmt = db.prepare(
    `UPDATE weather_stations SET status = ?, last_updated_at = ? WHERE id = ?`,
  );
  await batchIfNonEmpty(db, statuses.map((s) => stmt.bind(s.status, s.updatedAt, s.stationId)));
}

// Cameras are keyed by UUID (from the roadCameraLocations feed) — see tarktee.ts for why
// this differs from the numeric weather_stations.id. image_url is paid-tier data — see
// api-worker's cameras route for where that boundary is enforced (never in this file, which
// has no concept of free vs. paid).
export async function upsertCameras(db: D1Database, cameras: CameraMeta[]): Promise<void> {
  const stmt = db.prepare(
    `INSERT INTO cameras (id, name, lat, lng, image_url) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, lat = excluded.lat, lng = excluded.lng, image_url = excluded.image_url`,
  );
  await batchIfNonEmpty(db, cameras.map((c) => stmt.bind(c.id, c.name, c.lat, c.lng, c.imageUrl)));
}

/** Upserts hazards and returns only the ones that are new or changed since last poll
 *  (i.e. candidates for push-notification matching). */
export async function upsertHazardsAndGetChanged(
  db: D1Database,
  hazards: HazardRecord[],
): Promise<HazardRecord[]> {
  if (hazards.length === 0) return [];

  const existing = await db
    .prepare(
      `SELECT external_id, raw_json FROM hazards WHERE external_id IN (${hazards.map(() => "?").join(",")})`,
    )
    .bind(...hazards.map((h) => h.externalId))
    .all<{ external_id: string; raw_json: string }>();
  const existingByExternalId = new Map(existing.results.map((r) => [r.external_id, r.raw_json]));

  const changed = hazards.filter((h) => existingByExternalId.get(h.externalId) !== h.rawJson);

  const stmt = db.prepare(
    `INSERT INTO hazards (external_id, event_type, lat, lng, description, starts_at, ends_at, raw_json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(external_id) DO UPDATE SET
       event_type = excluded.event_type, lat = excluded.lat, lng = excluded.lng,
       description = excluded.description, starts_at = excluded.starts_at, ends_at = excluded.ends_at,
       raw_json = excluded.raw_json, updated_at = datetime('now')`,
  );
  await batchIfNonEmpty(
    db,
    hazards.map((h) =>
      stmt.bind(h.externalId, h.eventType, h.lat, h.lng, h.description, h.startsAt, h.endsAt, h.rawJson),
    ),
  );

  return changed;
}
