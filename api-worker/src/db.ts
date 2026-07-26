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
  is_admin: number;
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

// Scoped to userId + endpoint (not endpoint alone) so one user can't remove another's
// subscription even if they somehow knew its endpoint URL.
export async function deletePushSubscription(db: D1Database, userId: string, endpoint: string): Promise<void> {
  await db.prepare("DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?").bind(userId, endpoint).run();
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

export async function getUserByStripeCustomerId(db: D1Database, stripeCustomerId: string): Promise<UserRow | null> {
  const row = await db
    .prepare("SELECT * FROM users WHERE stripe_customer_id = ?")
    .bind(stripeCustomerId)
    .first<UserRow>();
  return row ?? null;
}

export async function getUserByEmail(db: D1Database, email: string): Promise<UserRow | null> {
  const row = await db.prepare("SELECT * FROM users WHERE email = ?").bind(email).first<UserRow>();
  return row ?? null;
}

/** Deletes the user row itself — every other user-owned table (saved_points,
 *  push_subscriptions, login_tokens, email_preferences) cascades via its own foreign key (see
 *  shared/schema.sql), so this single DELETE is the entire account/data deletion. Caller is
 *  responsible for cancelling any live Stripe subscription first (see routes/account.ts) —
 *  this function only ever touches D1, never Stripe. */
export async function deleteUser(db: D1Database, userId: string): Promise<void> {
  await db.prepare("DELETE FROM users WHERE id = ?").bind(userId).run();
}

/** How many login tokens this user has had issued in the last `windowMinutes` — used to cap
 *  how many sign-in emails one account can trigger in a short window (see
 *  handleRequestLogin), independent of whether those tokens were ever used. */
export async function countRecentLoginTokens(
  db: D1Database,
  userId: string,
  windowMinutes: number,
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM login_tokens WHERE user_id = ? AND created_at > datetime('now', ?)`,
    )
    .bind(userId, `-${windowMinutes} minutes`)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

export async function createLoginToken(
  db: D1Database,
  userId: string,
  expiresInMinutes: number,
): Promise<string> {
  const token = randomHex(32);
  await db
    .prepare(`INSERT INTO login_tokens (token, user_id, expires_at) VALUES (?, ?, datetime('now', ?))`)
    .bind(token, userId, `+${expiresInMinutes} minutes`)
    .run();
  return token;
}

/** Atomically consumes a login token — the UPDATE's own WHERE clause (not a separate
 *  check-then-use) is what makes this safe against the same token being submitted twice
 *  concurrently: only the first request's UPDATE can affect a row, since the second runs
 *  against a row that's already used_at-stamped. Returns the associated user only if the
 *  token existed, was unused, and hasn't expired. */
export async function consumeLoginToken(db: D1Database, token: string): Promise<UserRow | null> {
  const row = await db
    .prepare(
      `UPDATE login_tokens SET used_at = datetime('now')
       WHERE token = ? AND used_at IS NULL AND expires_at > datetime('now')
       RETURNING user_id`,
    )
    .bind(token)
    .first<{ user_id: string }>();
  if (!row) return null;

  const user = await db.prepare("SELECT * FROM users WHERE id = ?").bind(row.user_id).first<UserRow>();
  return user ?? null;
}

export interface EmailPreferences {
  productUpdates: boolean;
  serviceAnnouncements: boolean;
  billing: boolean;
}

const DEFAULT_EMAIL_PREFERENCES: EmailPreferences = {
  productUpdates: false,
  serviceAnnouncements: true,
  billing: true,
};

/** No row yet means nobody has ever changed anything, so the schema's own column defaults
 *  (see shared/schema.sql) apply — this just returns them without writing a row for every
 *  user who never touches their preferences. */
export async function getEmailPreferences(db: D1Database, userId: string): Promise<EmailPreferences> {
  const row = await db
    .prepare("SELECT product_updates, service_announcements, billing FROM email_preferences WHERE user_id = ?")
    .bind(userId)
    .first<{ product_updates: number; service_announcements: number; billing: number }>();
  if (!row) return DEFAULT_EMAIL_PREFERENCES;
  return {
    productUpdates: row.product_updates === 1,
    serviceAnnouncements: row.service_announcements === 1,
    billing: row.billing === 1,
  };
}

/** Partial update — only the categories present in `patch` change, the rest keep their
 *  current (or default, on first write) value. Used by both the authenticated in-app
 *  preferences UI (any subset of categories) and the public unsubscribe link (exactly one
 *  category, or all three for "unsubscribe from everything"). */
export async function updateEmailPreferences(
  db: D1Database,
  userId: string,
  patch: Partial<EmailPreferences>,
): Promise<EmailPreferences> {
  const current = await getEmailPreferences(db, userId);
  const next: EmailPreferences = { ...current, ...patch };
  await db
    .prepare(
      `INSERT INTO email_preferences (user_id, product_updates, service_announcements, billing, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(user_id) DO UPDATE SET
         product_updates = excluded.product_updates,
         service_announcements = excluded.service_announcements,
         billing = excluded.billing,
         updated_at = excluded.updated_at`,
    )
    .bind(userId, next.productUpdates ? 1 : 0, next.serviceAnnouncements ? 1 : 0, next.billing ? 1 : 0)
    .run();
  return next;
}

export interface AdminStats {
  usersByStatus: Record<string, number>;
  totalSavedPoints: number;
  totalPushSubscriptions: number;
  // Currently active only (matches getActiveHazards' own filter) — a raw all-time row count
  // would include hazards Tark Tee is still reporting but that have already ended, which isn't
  // what "how many hazards right now" should mean for an overview.
  activeHazardsByType: Record<string, number>;
  totalRestrictions: number;
  totalCameras: number;
  totalWeatherStations: number;
  totalVmsSigns: number;
}

export async function getAdminStats(db: D1Database): Promise<AdminStats> {
  const [statusRows, savedPointsRow, pushSubsRow, hazardTypeRows, restrictionsRow, camerasRow, weatherRow, vmsRow] =
    await Promise.all([
      db.prepare("SELECT subscription_status, COUNT(*) AS n FROM users GROUP BY subscription_status").all<{
        subscription_status: string;
        n: number;
      }>(),
      db.prepare("SELECT COUNT(*) AS n FROM saved_points").first<{ n: number }>(),
      db.prepare("SELECT COUNT(*) AS n FROM push_subscriptions").first<{ n: number }>(),
      db
        .prepare(
          `SELECT event_type, COUNT(*) AS n FROM hazards
           WHERE ends_at IS NULL OR ends_at > datetime('now')
           GROUP BY event_type`,
        )
        .all<{ event_type: string; n: number }>(),
      db.prepare("SELECT COUNT(*) AS n FROM restrictions").first<{ n: number }>(),
      db.prepare("SELECT COUNT(*) AS n FROM cameras").first<{ n: number }>(),
      db.prepare("SELECT COUNT(*) AS n FROM weather_stations").first<{ n: number }>(),
      db.prepare("SELECT COUNT(*) AS n FROM vms_signs").first<{ n: number }>(),
    ]);
  const usersByStatus: Record<string, number> = {};
  for (const row of statusRows.results) usersByStatus[row.subscription_status] = row.n;
  const activeHazardsByType: Record<string, number> = {};
  for (const row of hazardTypeRows.results) activeHazardsByType[row.event_type] = row.n;
  return {
    usersByStatus,
    totalSavedPoints: savedPointsRow?.n ?? 0,
    totalPushSubscriptions: pushSubsRow?.n ?? 0,
    activeHazardsByType,
    totalRestrictions: restrictionsRow?.n ?? 0,
    totalCameras: camerasRow?.n ?? 0,
    totalWeatherStations: weatherRow?.n ?? 0,
    totalVmsSigns: vmsRow?.n ?? 0,
  };
}

export interface AdminUserRow {
  id: string;
  email: string | null;
  subscription_status: string;
  created_at: string;
  saved_point_count: number;
}

// Correlated subquery (not a JOIN+GROUP BY) so a user with zero saved points still returns
// exactly one row with count 0, matching the same pattern getRestrictions already uses for
// detours — simplest way to get a per-user aggregate without collapsing/duplicating the
// parent row.
export async function getAdminUsers(db: D1Database, limit: number, offset: number): Promise<AdminUserRow[]> {
  const { results } = await db
    .prepare(
      `SELECT u.id, u.email, u.subscription_status, u.created_at,
              (SELECT COUNT(*) FROM saved_points WHERE user_id = u.id) AS saved_point_count
       FROM users u
       ORDER BY u.created_at DESC
       LIMIT ? OFFSET ?`,
    )
    .bind(limit, offset)
    .all<AdminUserRow>();
  return results;
}

export async function getAdminUserCount(db: D1Database): Promise<number> {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>();
  return row?.n ?? 0;
}

// Every table in shared/schema.sql — deliberately not just the "interesting" ones already
// covered by getAdminStats, since the point of this overview is "what's actually in the
// database," not a curated subset.
const ALL_TABLES = [
  "users",
  "login_tokens",
  "email_preferences",
  "push_subscriptions",
  "saved_points",
  "hazards",
  "vms_signs",
  "weather_stations",
  "restrictions",
  "translations",
  "weather_station_history",
  "detours",
  "cameras",
] as const;

export interface AdminDbOverview {
  sizeBytes: number;
  tableRowCounts: Record<string, number>;
}

export async function getAdminDbOverview(db: D1Database): Promise<AdminDbOverview> {
  const results = await Promise.all(
    ALL_TABLES.map((table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).all<{ n: number }>()),
  );
  const tableRowCounts: Record<string, number> = {};
  let sizeBytes = 0;
  for (let i = 0; i < results.length; i++) {
    tableRowCounts[ALL_TABLES[i]] = results[i].results[0]?.n ?? 0;
    // Same total DB size regardless of which query reports it — just take the last one seen.
    sizeBytes = results[i].meta.size_after ?? sizeBytes;
  }
  return { sizeBytes, tableRowCounts };
}
