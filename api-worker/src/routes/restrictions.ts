import { getRestrictions } from "../db";

export async function handleRestrictions(db: D1Database): Promise<Response> {
  const restrictions = await getRestrictions(db);
  const geojson = {
    type: "FeatureCollection",
    features: restrictions.map((r) => ({
      type: "Feature",
      properties: {
        id: r.id,
        roadNr: r.road_nr,
        roadName: r.road_name,
        roadType: r.road_type,
        cause: r.cause,
        effect: r.effect,
        extraInfo: r.extra_info,
        // detour_comment (from restrictions_traffic itself) is rarely populated in practice —
        // confirmed only 6 of 386 active restrictions have it. detour_description (joined from
        // the separate tram/detours service) is the real source for this; prefer it.
        detourDescription: r.detour_description ?? r.detour_comment,
        contractorOrganization: r.contractor_organization,
        contractorContactPhone: r.contractor_contact_phone,
        trafficCtrlOrganization: r.traffic_ctrl_organization,
        trafficCtrlContactPhone: r.traffic_ctrl_contact_phone,
        dateFrom: r.date_from,
        dateTo: r.date_to,
      },
      geometry: { type: "Point", coordinates: [r.lng, r.lat] },
    })),
  };
  return Response.json(geojson);
}
