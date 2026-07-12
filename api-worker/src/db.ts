export interface WeatherStationRow {
  id: number;
  name: string;
  lat: number;
  lng: number;
  road_status: string | null;
  road_status_aggregate: string | null;
  road_temp: number | null;
  air_temp: number | null;
  precipitation_type: string | null;
  precipitation_intensity: number | null;
  wind_dir: number | null;
  wind_speed: number | null;
  air_humidity: number | null;
  visibility: number | null;
  grip_factor: number | null;
  measurement_time: string | null;
  last_updated_at: string | null;
}

export interface RestrictionRow {
  id: number;
  road_nr: number | null;
  road_name: string | null;
  road_type: string | null;
  cause: string | null;
  effect: string | null;
  extra_info: string | null;
  extra_info_en: string | null;
  detour_comment: string | null;
  contractor_organization: string | null;
  contractor_contact_phone: string | null;
  traffic_ctrl_organization: string | null;
  traffic_ctrl_contact_phone: string | null;
  date_from: string | null;
  date_to: string | null;
  lat: number;
  lng: number;
  detour_description: string | null;
}

export interface CameraRow {
  id: string; // UUID, from the DATEX II roadCameraLocations feed — see ingest-worker's tarktee.ts
  name: string;
  lat: number;
  lng: number;
  image_url: string | null; // paid-tier only — never include this in the free /api/cameras response
}

export interface HazardRow {
  external_id: string;
  event_type: string;
  lat: number;
  lng: number;
  description: string | null;
  starts_at: string | null;
  ends_at: string | null;
  updated_at: string;
}

export interface VmsSignRow {
  sign_id: number;
  road_nr: number | null;
  road_name: string | null;
  road_km: number | null;
  angle: number | null;
  speed_limit: number | null;
  speed_limit_changed_at: string | null;
  warning: string | null;
  warning_changed_at: string | null;
  lat: number;
  lng: number;
}

export async function getWeatherStations(db: D1Database): Promise<WeatherStationRow[]> {
  const { results } = await db.prepare("SELECT * FROM weather_stations").all<WeatherStationRow>();
  return results;
}

export async function getVmsSigns(db: D1Database): Promise<VmsSignRow[]> {
  const { results } = await db.prepare("SELECT * FROM vms_signs").all<VmsSignRow>();
  return results;
}

// Correlated subquery (not a JOIN) so a restriction with more than one detours row still
// returns exactly one restriction row — detours are shown merged into the restriction's own
// popup (see Map.tsx), not as separate markers, so there's nothing to do with a second match
// beyond picking one.
export async function getRestrictions(db: D1Database): Promise<RestrictionRow[]> {
  const { results } = await db
    .prepare(
      `SELECT r.*,
              (SELECT description FROM detours WHERE restriction_id = r.id AND description IS NOT NULL ORDER BY id LIMIT 1) AS detour_description
       FROM restrictions r`,
    )
    .all<RestrictionRow>();
  return results;
}

export interface WeatherHistoryRow {
  recorded_at: string;
  road_status: string | null;
  road_status_aggregate: string | null;
  road_temp: number | null;
  air_temp: number | null;
  precipitation_type: string | null;
  precipitation_intensity: number | null;
  wind_dir: number | null;
  wind_speed: number | null;
  air_humidity: number | null;
  visibility: number | null;
  grip_factor: number | null;
}

export async function getWeatherStationHistory(db: D1Database, stationName: string): Promise<WeatherHistoryRow[]> {
  const { results } = await db
    .prepare(
      `SELECT recorded_at, road_status, road_status_aggregate, road_temp, air_temp,
              precipitation_type, precipitation_intensity, wind_dir, wind_speed, air_humidity,
              visibility, grip_factor
       FROM weather_station_history WHERE station_name = ? ORDER BY recorded_at ASC`,
    )
    .bind(stationName)
    .all<WeatherHistoryRow>();
  return results;
}

export async function getCameras(db: D1Database): Promise<CameraRow[]> {
  const { results } = await db.prepare("SELECT * FROM cameras").all<CameraRow>();
  return results;
}

export async function getCameraById(db: D1Database, id: string): Promise<CameraRow | null> {
  const row = await db.prepare("SELECT * FROM cameras WHERE id = ?").bind(id).first<CameraRow>();
  return row ?? null;
}

/** Active hazards only (ends_at is null or in the future). */
export async function getActiveHazards(db: D1Database): Promise<HazardRow[]> {
  const { results } = await db
    .prepare(
      `SELECT external_id, event_type, lat, lng, description, starts_at, ends_at, updated_at
       FROM hazards WHERE ends_at IS NULL OR ends_at > datetime('now')`,
    )
    .all<HazardRow>();
  return results;
}

export interface UserRow {
  id: string;
  email: string | null;
  stripe_customer_id: string | null;
  subscription_status: string;
  bearer_token: string | null;
}

export interface SavedPointRow {
  id: number;
  user_id: string;
  label: string;
  lat: number;
  lng: number;
  radius_km: number;
  event_types: string | null; // JSON array string, or null = all types
}

export async function getSavedPointsByUser(db: D1Database, userId: string): Promise<SavedPointRow[]> {
  const { results } = await db
    .prepare("SELECT * FROM saved_points WHERE user_id = ?")
    .bind(userId)
    .all<SavedPointRow>();
  return results;
}

export async function createSavedPoint(
  db: D1Database,
  params: { userId: string; label: string; lat: number; lng: number; radiusKm: number; eventTypes: string[] | null },
): Promise<SavedPointRow> {
  const row = await db
    .prepare(
      `INSERT INTO saved_points (user_id, label, lat, lng, radius_km, event_types)
       VALUES (?, ?, ?, ?, ?, ?)
       RETURNING *`,
    )
    .bind(
      params.userId,
      params.label,
      params.lat,
      params.lng,
      params.radiusKm,
      params.eventTypes ? JSON.stringify(params.eventTypes) : null,
    )
    .first<SavedPointRow>();
  if (!row) throw new Error("createSavedPoint: RETURNING produced no row");
  return row;
}

/** True only if a row belonging to this user was actually deleted — lets the route respond
 *  404 for both "no such id" and "someone else's point" without distinguishing the two. */
export async function deleteSavedPoint(db: D1Database, id: number, userId: string): Promise<boolean> {
  const result = await db.prepare("DELETE FROM saved_points WHERE id = ? AND user_id = ?").bind(id, userId).run();
  return (result.meta?.changes ?? 0) > 0;
}

export interface PushSubscriptionRow {
  id: number;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  failure_count: number;
}

/** Upserts by endpoint — a browser can resubscribe with the same endpoint (refreshing keys)
 *  or a new one (e.g. after clearing site data). failure_count resets to 0 on any successful
 *  (re)subscribe, since a fresh subscription hasn't failed yet. */
export async function upsertPushSubscription(
  db: D1Database,
  params: { userId: string; endpoint: string; p256dh: string; auth: string },
): Promise<PushSubscriptionRow> {
  const row = await db
    .prepare(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(endpoint) DO UPDATE SET
         user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, failure_count = 0
       RETURNING *`,
    )
    .bind(params.userId, params.endpoint, params.p256dh, params.auth)
    .first<PushSubscriptionRow>();
  if (!row) throw new Error("upsertPushSubscription: RETURNING produced no row");
  return row;
}

export async function getUserByBearerToken(db: D1Database, token: string): Promise<UserRow | null> {
  const row = await db
    .prepare("SELECT * FROM users WHERE bearer_token = ?")
    .bind(token)
    .first<UserRow>();
  return row ?? null;
}

function randomHex(byteLength: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Idempotent upsert keyed by Stripe customer ID — safe to call from both the checkout
 *  return-URL handler (fast path, issues the token the user actually sees) and the webhook
 *  (authoritative path for ongoing status changes like renewals/cancellations). `id` and
 *  `bearer_token` are only used on first insert; ON CONFLICT deliberately leaves them
 *  untouched so a returning customer keeps the same token rather than getting a new one
 *  every time their subscription status changes. */
export async function upsertUserFromStripe(
  db: D1Database,
  params: { stripeCustomerId: string; email: string | null; subscriptionStatus: string },
): Promise<UserRow> {
  const row = await db
    .prepare(
      `INSERT INTO users (id, email, stripe_customer_id, subscription_status, bearer_token)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(stripe_customer_id) DO UPDATE SET
         email = excluded.email,
         subscription_status = excluded.subscription_status
       RETURNING *`,
    )
    .bind(randomHex(16), params.email, params.stripeCustomerId, params.subscriptionStatus, randomHex(24))
    .first<UserRow>();
  if (!row) throw new Error("upsertUserFromStripe: RETURNING produced no row");
  return row;
}

export async function updateSubscriptionStatusByStripeCustomerId(
  db: D1Database,
  stripeCustomerId: string,
  subscriptionStatus: string,
): Promise<void> {
  await db
    .prepare("UPDATE users SET subscription_status = ? WHERE stripe_customer_id = ?")
    .bind(subscriptionStatus, stripeCustomerId)
    .run();
}
