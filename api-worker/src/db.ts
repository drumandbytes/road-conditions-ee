export interface WeatherStationRow {
  id: number;
  name: string;
  lat: number;
  lng: number;
  status: string | null;
  last_updated_at: string | null;
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
