import type { UserRow } from "../db";
import { getVmsSigns } from "../db";

/** Paid tier: live electronic road sign (VMS) content — no free tier makes sense here
 *  (unlike cameras' "location only" fallback), so this is fully gated on subscription status. */
export async function handleVms(db: D1Database, user: UserRow | null): Promise<Response> {
  if (!user) {
    return Response.json({ error: "VMS board data requires an active subscription" }, { status: 402 });
  }
  const signs = await getVmsSigns(db);
  const geojson = {
    type: "FeatureCollection",
    features: signs.map((s) => ({
      type: "Feature",
      properties: {
        id: s.sign_id,
        roadNr: s.road_nr,
        roadName: s.road_name,
        roadKm: s.road_km,
        angle: s.angle,
        speedLimit: s.speed_limit,
        speedLimitChangedAt: s.speed_limit_changed_at,
        warning: s.warning,
        warningChangedAt: s.warning_changed_at,
      },
      geometry: { type: "Point", coordinates: [s.lng, s.lat] },
    })),
  };
  return Response.json(geojson);
}
