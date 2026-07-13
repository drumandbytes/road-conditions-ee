import type { UserRow } from "../db";
import { getVmsSigns } from "../db";

/** Free tier: sign locations + road context only, visible to everyone — same "location
 *  visible, live content gated" shape as cameras' free/paid split. The paid property
 *  distinguishes this client-side (a locked marker vs. a normal one with nothing currently
 *  active — two different reasons for "no speed limit shown" that read very differently to a
 *  user). Deliberately builds properties from named fields rather than spreading the row, so
 *  speedLimit/warning (paid-tier only) can never leak into the free response even if
 *  VmsSignRow grows more paid-tier columns later. */
export async function handleVms(db: D1Database, user: UserRow | null): Promise<Response> {
  const signs = await getVmsSigns(db);
  const paid = user !== null;
  const geojson = {
    type: "FeatureCollection",
    features: signs.map((s) => ({
      type: "Feature",
      properties: paid
        ? {
            id: s.sign_id,
            roadNr: s.road_nr,
            roadName: s.road_name,
            roadKm: s.road_km,
            angle: s.angle,
            speedLimit: s.speed_limit,
            speedLimitChangedAt: s.speed_limit_changed_at,
            warning: s.warning,
            warningChangedAt: s.warning_changed_at,
            paid: true,
          }
        : {
            id: s.sign_id,
            roadName: s.road_name,
            roadKm: s.road_km,
            paid: false,
          },
      geometry: { type: "Point", coordinates: [s.lng, s.lat] },
    })),
  };
  return Response.json(geojson);
}
