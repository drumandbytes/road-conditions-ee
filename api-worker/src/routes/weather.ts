import { getWeatherStations } from "../db";

export async function handleWeatherStations(db: D1Database): Promise<Response> {
  const stations = await getWeatherStations(db);
  const geojson = {
    type: "FeatureCollection",
    features: stations.map((s) => ({
      type: "Feature",
      properties: {
        id: s.id,
        name: s.name,
        roadStatus: s.road_status,
        roadStatusAggregate: s.road_status_aggregate,
        roadTemp: s.road_temp,
        airTemp: s.air_temp,
        precipitationType: s.precipitation_type,
        precipitationIntensity: s.precipitation_intensity,
        windDir: s.wind_dir,
        windSpeed: s.wind_speed,
        airHumidity: s.air_humidity,
        visibility: s.visibility,
        gripFactor: s.grip_factor,
        measurementTime: s.measurement_time,
        lastUpdatedAt: s.last_updated_at,
      },
      geometry: { type: "Point", coordinates: [s.lng, s.lat] },
    })),
  };
  return Response.json(geojson);
}
