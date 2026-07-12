import { getWeatherStationHistory } from "../db";
import type { UserRow } from "../db";

/** Paid tier: hourly readings for one station over its retained history window (7 days —
 *  see ingest-worker's pruneWeatherHistory). Station identity is its name, not
 *  weather_stations.id (the upstream id isn't stable — see ingest-worker's db.ts). */
export async function handleWeatherStationHistory(
  stationName: string,
  user: UserRow | null,
  db: D1Database,
): Promise<Response> {
  if (!user) {
    return Response.json({ error: "Weather history requires an active subscription" }, { status: 402 });
  }

  const rows = await getWeatherStationHistory(db, stationName);
  return Response.json({
    stationName,
    readings: rows.map((r) => ({
      recordedAt: r.recorded_at,
      roadStatus: r.road_status,
      roadStatusAggregate: r.road_status_aggregate,
      roadTemp: r.road_temp,
      airTemp: r.air_temp,
      precipitationType: r.precipitation_type,
      precipitationIntensity: r.precipitation_intensity,
      windDir: r.wind_dir,
      windSpeed: r.wind_speed,
      airHumidity: r.air_humidity,
      visibility: r.visibility,
      gripFactor: r.grip_factor,
    })),
  });
}
