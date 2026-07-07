import { getWeatherStations } from "../db";

export async function handleWeatherStations(db: D1Database): Promise<Response> {
  const stations = await getWeatherStations(db);
  const geojson = {
    type: "FeatureCollection",
    features: stations.map((s) => ({
      type: "Feature",
      properties: { id: s.id, name: s.name, status: s.status, lastUpdatedAt: s.last_updated_at },
      geometry: { type: "Point", coordinates: [s.lng, s.lat] },
    })),
  };
  return Response.json(geojson);
}
