import type { CameraMeta, HazardRecord } from "./tarktee";
import type { Restriction, WeatherReading } from "./arcgis";

// db.batch([]) throws "D1_ERROR: No SQL statements detected" on an empty array — confirmed
// in production (broke the cameras upsert when every entry from the old, broken metadata
// endpoint had null geometry, which silently killed the rest of that poll cycle too). Guard
// every batch call with this rather than relying on callers to never pass an empty list.
async function batchIfNonEmpty(db: D1Database, statements: D1PreparedStatement[]): Promise<void> {
  if (statements.length === 0) return;
  await db.batch(statements);
}

export async function upsertWeatherReadings(db: D1Database, readings: WeatherReading[]): Promise<void> {
  const stmt = db.prepare(
    `INSERT INTO weather_stations (
       id, name, lat, lng, road_status, road_status_aggregate, road_temp, air_temp,
       precipitation_type, precipitation_intensity, wind_dir, wind_speed, air_humidity,
       visibility, grip_factor, measurement_time, last_updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name, lat = excluded.lat, lng = excluded.lng,
       road_status = excluded.road_status, road_status_aggregate = excluded.road_status_aggregate,
       road_temp = excluded.road_temp, air_temp = excluded.air_temp,
       precipitation_type = excluded.precipitation_type, precipitation_intensity = excluded.precipitation_intensity,
       wind_dir = excluded.wind_dir, wind_speed = excluded.wind_speed, air_humidity = excluded.air_humidity,
       visibility = excluded.visibility, grip_factor = excluded.grip_factor,
       measurement_time = excluded.measurement_time, last_updated_at = datetime('now')`,
  );
  await batchIfNonEmpty(
    db,
    readings.map((r) =>
      stmt.bind(
        r.id, r.name, r.lat, r.lng, r.roadStatus, r.roadStatusAggregate, r.roadTemp, r.airTemp,
        r.precipitationType, r.precipitationIntensity, r.windDir, r.windSpeed, r.airHumidity,
        r.visibility, r.gripFactor, r.measurementTime,
      ),
    ),
  );

  // The upstream objectid set isn't fully stable poll to poll — confirmed directly in
  // production (D1 accumulated 213 distinct ids from a feed that only ever reports ~117 at
  // once). Sweep out anything that fell out of the current response, same pattern as
  // restrictions below. Short grace window since this feed refreshes every 2 minutes, unlike
  // restrictions' 1-hour one.
  if (readings.length > 0) {
    const placeholders = readings.map(() => "?").join(",");
    await db
      .prepare(`DELETE FROM weather_stations WHERE id NOT IN (${placeholders}) AND (last_updated_at IS NULL OR last_updated_at < datetime('now', '-10 minutes'))`)
      .bind(...readings.map((r) => r.id))
      .run();
  }
}

export async function upsertRestrictions(db: D1Database, restrictions: Restriction[]): Promise<void> {
  const stmt = db.prepare(
    `INSERT INTO restrictions (
       id, road_nr, road_name, road_type, cause, effect, extra_info, detour_comment,
       contractor_organization, contractor_contact_phone, traffic_ctrl_organization,
       traffic_ctrl_contact_phone, date_from, date_to, lat, lng, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       road_nr = excluded.road_nr, road_name = excluded.road_name, road_type = excluded.road_type,
       cause = excluded.cause, effect = excluded.effect, extra_info = excluded.extra_info,
       detour_comment = excluded.detour_comment, contractor_organization = excluded.contractor_organization,
       contractor_contact_phone = excluded.contractor_contact_phone,
       traffic_ctrl_organization = excluded.traffic_ctrl_organization,
       traffic_ctrl_contact_phone = excluded.traffic_ctrl_contact_phone,
       date_from = excluded.date_from, date_to = excluded.date_to,
       lat = excluded.lat, lng = excluded.lng, updated_at = datetime('now')`,
  );
  await batchIfNonEmpty(
    db,
    restrictions.map((r) =>
      stmt.bind(
        r.id, r.roadNr, r.roadName, r.roadType, r.cause, r.effect, r.extraInfo, r.detourComment,
        r.contractorOrganization, r.contractorContactPhone, r.trafficCtrlOrganization,
        r.trafficCtrlContactPhone, r.dateFrom, r.dateTo, r.lat, r.lng,
      ),
    ),
  );

  // Restrictions ending/no-longer-qualifying under the active-window filter (see arcgis.ts's
  // activeRestrictionsWhereClause) fall out of the upstream response entirely rather than
  // coming back with an updated date_to — so unlike hazards/cameras, stale rows here need an
  // explicit sweep, not just an upsert.
  if (restrictions.length > 0) {
    const placeholders = restrictions.map(() => "?").join(",");
    await db
      .prepare(`DELETE FROM restrictions WHERE id NOT IN (${placeholders}) AND updated_at < datetime('now', '-1 hour')`)
      .bind(...restrictions.map((r) => r.id))
      .run();
  }
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
