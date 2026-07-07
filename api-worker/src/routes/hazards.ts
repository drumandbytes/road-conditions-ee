import { getActiveHazards } from "../db";

export async function handleHazards(db: D1Database): Promise<Response> {
  const hazards = await getActiveHazards(db);
  const geojson = {
    type: "FeatureCollection",
    features: hazards.map((h) => ({
      type: "Feature",
      properties: {
        id: h.external_id,
        eventType: h.event_type,
        description: h.description,
        startsAt: h.starts_at,
        endsAt: h.ends_at,
        updatedAt: h.updated_at,
      },
      geometry: { type: "Point", coordinates: [h.lng, h.lat] },
    })),
  };
  return Response.json(geojson);
}
