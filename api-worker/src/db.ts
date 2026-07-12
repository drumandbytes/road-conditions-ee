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
  detour_comment: string | null;
  contractor_organization: string | null;
  contractor_contact_phone: string | null;
  traffic_ctrl_organization: string | null;
  traffic_ctrl_contact_phone: string | null;
  date_from: string | null;
  date_to: string | null;
  lat: number;
  lng: number;
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

export async function getWeatherStations(db: D1Database): Promise<WeatherStationRow[]> {
  const { results } = await db.prepare("SELECT * FROM weather_stations").all<WeatherStationRow>();
  return results;
}

export async function getRestrictions(db: D1Database): Promise<RestrictionRow[]> {
  const { results } = await db.prepare("SELECT * FROM restrictions").all<RestrictionRow>();
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
