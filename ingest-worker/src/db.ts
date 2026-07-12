import type { CameraMeta, HazardRecord } from "./tarktee";
import type { Detour, Restriction, VmsSign, WeatherReading } from "./arcgis";
import { translateWithTemplateCache } from "./translate";
import type { TranslationBudget } from "./translate";

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
  // once). Every row still present gets its last_updated_at refreshed by the upsert above, so
  // anything whose timestamp hasn't moved recently is exactly what fell out of the feed — no
  // need to pass the current id set at all. (A first attempt at this used
  // `WHERE id NOT IN (...117 placeholders...)`, which broke in production with D1_ERROR: too
  // many SQL variables once restrictions' equivalent sweep hit ~380 placeholders — this
  // timestamp-only version has no such ceiling.)
  await db
    .prepare(`DELETE FROM weather_stations WHERE last_updated_at IS NULL OR last_updated_at < datetime('now', '-10 minutes')`)
    .run();
}

// One row per station per hour, keyed by station_name (not weather_stations.id — see
// upsertWeatherReadings' comment on why that id isn't durable enough for history).
//
// INSERT OR IGNORE, not an upsert — a real production bug, not a theoretical one: this ran on
// every poll cycle with ON CONFLICT DO UPDATE, which pushed D1's rows-written usage to ~5.7x
// its free-tier daily quota (confirmed directly from the Cloudflare dashboard). Every poll
// re-writing the same hour's row is pure waste for a table whose entire point is hourly
// granularity — OR IGNORE means only the first poll of each hour actually writes; every
// later poll that hour hits the (station_name, recorded_at) unique index and does nothing.
export async function upsertWeatherHistory(
  db: D1Database,
  readings: WeatherReading[],
  hourBucket: string,
): Promise<void> {
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO weather_station_history (
       station_name, recorded_at, road_status, road_status_aggregate, road_temp, air_temp,
       precipitation_type, precipitation_intensity, wind_dir, wind_speed, air_humidity,
       visibility, grip_factor
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  await batchIfNonEmpty(
    db,
    readings.map((r) =>
      stmt.bind(
        r.name, hourBucket, r.roadStatus, r.roadStatusAggregate, r.roadTemp, r.airTemp,
        r.precipitationType, r.precipitationIntensity, r.windDir, r.windSpeed, r.airHumidity,
        r.visibility, r.gripFactor,
      ),
    ),
  );
}

export async function pruneWeatherHistory(db: D1Database, olderThanDays: number): Promise<void> {
  await db
    .prepare(`DELETE FROM weather_station_history WHERE recorded_at < datetime('now', ?)`)
    .bind(`-${olderThanDays} days`)
    .run();
}

// Bounded-concurrency map — keeps translation throughput steady and predictable. Doesn't by
// itself cap the *total* number of AI calls in an invocation (see MAX_TRANSLATIONS_PER_CYCLE
// / TranslationBudget for that — confirmed directly in production that the real ceiling is a
// total-count one, not a concurrency one).
async function mapWithConcurrency<T>(items: T[], concurrency: number, fn: (item: T) => Promise<void>): Promise<void> {
  let index = 0;
  async function worker(): Promise<void> {
    while (index < items.length) {
      await fn(items[index++]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
}

// How many AI calls translateChangedExtraInfo is willing to make in one poll — see
// TranslationBudget in translate.ts for why this exists (the 50-subrequest-per-invocation
// ceiling on Workers Free, shared with every other fetch() this poll cycle makes). Deliberately
// well under the ~40 that'd theoretically be left after weather/hazards/restrictions/detours'
// own fetches, since hazards alone can fire up to 7 in parallel.
const TRANSLATE_CONCURRENCY = 8;
const MAX_TRANSLATIONS_PER_CYCLE = 20;

interface ExistingRestrictionRow {
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
}

// True when the raw upstream fields differ, OR when extra_info is set but was never
// successfully translated (a retry candidate) — both cases need this row written; a row whose
// fields are byte-identical to what's already stored needs nothing at all.
function restrictionNeedsWrite(existing: ExistingRestrictionRow | undefined, r: Restriction): boolean {
  if (!existing) return true;
  if (r.extraInfo && !existing.extra_info_en) return true;
  return (
    existing.road_nr !== r.roadNr ||
    existing.road_name !== r.roadName ||
    existing.road_type !== r.roadType ||
    existing.cause !== r.cause ||
    existing.effect !== r.effect ||
    existing.extra_info !== r.extraInfo ||
    existing.detour_comment !== r.detourComment ||
    existing.contractor_organization !== r.contractorOrganization ||
    existing.contractor_contact_phone !== r.contractorContactPhone ||
    existing.traffic_ctrl_organization !== r.trafficCtrlOrganization ||
    existing.traffic_ctrl_contact_phone !== r.trafficCtrlContactPhone ||
    existing.date_from !== r.dateFrom ||
    existing.date_to !== r.dateTo ||
    existing.lat !== r.lat ||
    existing.lng !== r.lng
  );
}

// Translates extra_info (Estonian-only free text, no upstream English variant — see
// translate.ts) and caches it in extra_info_en, rather than re-translating identical text
// every poll. Takes the already-fetched existingById map from upsertRestrictions (which needs
// the full table read anyway to diff every field, not just extra_info) rather than doing its
// own separate SELECT. Cache layers, cheapest first: (1) this exact restriction's own row, if
// its extra_info hasn't changed since last poll; (2) other restrictions in *this same batch*
// with byte-identical extra_info, deduped before any AI call; (3) the shared translations
// table inside translateWithTemplateCache, keyed by template — covers a *different*
// restriction whose text matches a known pattern, e.g. every "Kiirus piiratud {N} km/h."
// variant. Only a genuine miss on all three reaches Workers AI, and even then only up to
// MAX_TRANSLATIONS_PER_CYCLE times.
async function translateChangedExtraInfo(
  db: D1Database,
  ai: Ai,
  restrictions: Restriction[],
  existingById: Map<number, ExistingRestrictionRow>,
): Promise<Map<number, string | null>> {
  const withExtraInfo = restrictions.filter((r) => r.extraInfo);
  if (withExtraInfo.length === 0) return new Map();

  const translations = new Map<number, string | null>();
  const needsTranslation: Restriction[] = [];
  for (const r of withExtraInfo) {
    const prior = existingById.get(r.id);
    if (prior && prior.extra_info === r.extraInfo && prior.extra_info_en) {
      translations.set(r.id, prior.extra_info_en);
    } else {
      needsTranslation.push(r);
    }
  }

  const distinctTexts = [...new Set(needsTranslation.map((r) => r.extraInfo!))];
  // Real AI calls share the same 50-per-invocation subrequest budget as every fetch() this
  // poll cycle makes elsewhere (weather, hazards, restrictions, detours) — capped well under
  // that to leave room for the rest. Cache hits don't count against it (see translate.ts), so
  // this only throttles genuinely new/changed text; anything left over this cycle just retries
  // next poll (3 minutes later) since extra_info_en stays null until it succeeds.
  const budget: TranslationBudget = { remaining: MAX_TRANSLATIONS_PER_CYCLE };
  const textTranslations = new Map<string, string | null>();
  await mapWithConcurrency(distinctTexts, TRANSLATE_CONCURRENCY, async (text) => {
    textTranslations.set(text, await translateWithTemplateCache(db, ai, text, budget));
  });

  for (const r of needsTranslation) {
    translations.set(r.id, textTranslations.get(r.extraInfo!) ?? null);
  }
  return translations;
}

// Diffs against what's already stored rather than blindly rewriting every row every poll —
// this is what makes it safe to fetch restrictions on the same 3-min cadence as weather (it
// used to be a 30-min-only feed specifically to keep write volume down, which meant a brand
// new closure or a changed detour could take up to 30 minutes to show up). Rows whose fields
// are unchanged from last poll cost nothing at all; only genuinely new/changed rows get
// written, and only rows that actually disappeared from the upstream feed get deleted (a
// small, bounded list — not the `id NOT IN (...)` sweep that broke on this table's ~380 rows
// with a "too many SQL variables" error earlier this session).
export async function upsertRestrictions(db: D1Database, ai: Ai, restrictions: Restriction[]): Promise<void> {
  const existing = await db.prepare("SELECT * FROM restrictions").all<ExistingRestrictionRow>();
  const existingById = new Map(existing.results.map((r) => [r.id, r]));

  const changed = restrictions.filter((r) => restrictionNeedsWrite(existingById.get(r.id), r));
  const translations = await translateChangedExtraInfo(db, ai, changed, existingById);

  const stmt = db.prepare(
    `INSERT INTO restrictions (
       id, road_nr, road_name, road_type, cause, effect, extra_info, extra_info_en, detour_comment,
       contractor_organization, contractor_contact_phone, traffic_ctrl_organization,
       traffic_ctrl_contact_phone, date_from, date_to, lat, lng, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       road_nr = excluded.road_nr, road_name = excluded.road_name, road_type = excluded.road_type,
       cause = excluded.cause, effect = excluded.effect, extra_info = excluded.extra_info,
       extra_info_en = excluded.extra_info_en,
       detour_comment = excluded.detour_comment, contractor_organization = excluded.contractor_organization,
       contractor_contact_phone = excluded.contractor_contact_phone,
       traffic_ctrl_organization = excluded.traffic_ctrl_organization,
       traffic_ctrl_contact_phone = excluded.traffic_ctrl_contact_phone,
       date_from = excluded.date_from, date_to = excluded.date_to,
       lat = excluded.lat, lng = excluded.lng, updated_at = datetime('now')`,
  );
  await batchIfNonEmpty(
    db,
    changed.map((r) =>
      stmt.bind(
        r.id, r.roadNr, r.roadName, r.roadType, r.cause, r.effect, r.extraInfo,
        translations.get(r.id) ?? null, r.detourComment,
        r.contractorOrganization, r.contractorContactPhone, r.trafficCtrlOrganization,
        r.trafficCtrlContactPhone, r.dateFrom, r.dateTo, r.lat, r.lng,
      ),
    ),
  );

  const currentIds = new Set(restrictions.map((r) => r.id));
  const disappearedIds = existing.results.map((r) => r.id).filter((id) => !currentIds.has(id));
  if (disappearedIds.length > 0) {
    const placeholders = disappearedIds.map(() => "?").join(",");
    await db.prepare(`DELETE FROM restrictions WHERE id IN (${placeholders})`).bind(...disappearedIds).run();
  }
}

interface ExistingDetourRow {
  id: number;
  restriction_id: number | null;
  description: string | null;
  date_from: string | null;
  date_to: string | null;
}

function detourNeedsWrite(existing: ExistingDetourRow | undefined, d: Detour): boolean {
  if (!existing) return true;
  return (
    existing.restriction_id !== d.restrictionId ||
    existing.description !== d.description ||
    existing.date_from !== d.dateFrom ||
    existing.date_to !== d.dateTo
  );
}

// Same diff-based approach as restrictions above, for the same reason — lets this run on the
// fast cron alongside the restriction it's tied to, instead of lagging up to 30 minutes behind.
export async function upsertDetours(db: D1Database, detours: Detour[]): Promise<void> {
  const existing = await db
    .prepare("SELECT id, restriction_id, description, date_from, date_to FROM detours")
    .all<ExistingDetourRow>();
  const existingById = new Map(existing.results.map((d) => [d.id, d]));

  const changed = detours.filter((d) => detourNeedsWrite(existingById.get(d.id), d));

  const stmt = db.prepare(
    `INSERT INTO detours (id, restriction_id, description, date_from, date_to, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(id) DO UPDATE SET
       restriction_id = excluded.restriction_id, description = excluded.description,
       date_from = excluded.date_from, date_to = excluded.date_to, updated_at = datetime('now')`,
  );
  await batchIfNonEmpty(
    db,
    changed.map((d) => stmt.bind(d.id, d.restrictionId, d.description, d.dateFrom, d.dateTo)),
  );

  const currentIds = new Set(detours.map((d) => d.id));
  const disappearedIds = existing.results.map((d) => d.id).filter((id) => !currentIds.has(id));
  if (disappearedIds.length > 0) {
    const placeholders = disappearedIds.map(() => "?").join(",");
    await db.prepare(`DELETE FROM detours WHERE id IN (${placeholders})`).bind(...disappearedIds).run();
  }
}

interface ExistingVmsSignRow {
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

function vmsSignNeedsWrite(existing: ExistingVmsSignRow | undefined, s: VmsSign): boolean {
  if (!existing) return true;
  return (
    existing.road_nr !== s.roadNr ||
    existing.road_name !== s.roadName ||
    existing.road_km !== s.roadKm ||
    existing.angle !== s.angle ||
    existing.speed_limit !== s.speedLimit ||
    existing.speed_limit_changed_at !== s.speedLimitChangedAt ||
    existing.warning !== s.warning ||
    existing.warning_changed_at !== s.warningChangedAt ||
    existing.lat !== s.lat ||
    existing.lng !== s.lng
  );
}

// Same diff-based approach as restrictions/detours above — VMS content (speed_limit/warning)
// changes far less often than the 3-min poll cycle, so most polls write nothing at all.
export async function upsertVmsSigns(db: D1Database, signs: VmsSign[]): Promise<void> {
  const existing = await db.prepare("SELECT * FROM vms_signs").all<ExistingVmsSignRow>();
  const existingById = new Map(existing.results.map((s) => [s.sign_id, s]));

  const changed = signs.filter((s) => vmsSignNeedsWrite(existingById.get(s.id), s));

  const stmt = db.prepare(
    `INSERT INTO vms_signs (
       sign_id, road_nr, road_name, road_km, angle, speed_limit, speed_limit_changed_at,
       warning, warning_changed_at, lat, lng, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(sign_id) DO UPDATE SET
       road_nr = excluded.road_nr, road_name = excluded.road_name, road_km = excluded.road_km,
       angle = excluded.angle, speed_limit = excluded.speed_limit,
       speed_limit_changed_at = excluded.speed_limit_changed_at, warning = excluded.warning,
       warning_changed_at = excluded.warning_changed_at, lat = excluded.lat, lng = excluded.lng,
       updated_at = datetime('now')`,
  );
  await batchIfNonEmpty(
    db,
    changed.map((s) =>
      stmt.bind(
        s.id, s.roadNr, s.roadName, s.roadKm, s.angle, s.speedLimit, s.speedLimitChangedAt,
        s.warning, s.warningChangedAt, s.lat, s.lng,
      ),
    ),
  );

  const currentIds = new Set(signs.map((s) => s.id));
  const disappearedIds = existing.results.map((s) => s.sign_id).filter((id) => !currentIds.has(id));
  if (disappearedIds.length > 0) {
    const placeholders = disappearedIds.map(() => "?").join(",");
    await db.prepare(`DELETE FROM vms_signs WHERE sign_id IN (${placeholders})`).bind(...disappearedIds).run();
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
