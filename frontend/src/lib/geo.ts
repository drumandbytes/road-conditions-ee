const EARTH_RADIUS_KM = 6371;

// Points around the circle — enough for a visually smooth curve at the zoom levels this is
// shown at (street/city level while placing a pin), without generating an oversized polygon.
const CIRCLE_STEPS = 64;

/** Destination point `distanceKm` away from (lat, lng) along `bearingDeg` (0 = north),
 *  via the standard spherical-earth direct geodesic formula. */
function destinationPoint(lat: number, lng: number, distanceKm: number, bearingDeg: number): [number, number] {
  const angularDistance = distanceKm / EARTH_RADIUS_KM;
  const bearing = (bearingDeg * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lng1 = (lng * Math.PI) / 180;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance) + Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(bearing),
  );
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(bearing) * Math.sin(angularDistance) * Math.cos(lat1),
      Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2),
    );

  return [(lng2 * 180) / Math.PI, (lat2 * 180) / Math.PI];
}

/** Great-circle distance between two points, in km — standard haversine formula. Used by the
 *  map search feature to sort nearby hazards/cameras/etc. by distance from a searched point;
 *  ingest-worker has its own server-side copy of the same formula (for saved-point radius
 *  matching) that this doesn't share, since the two packages don't share code. */
export function haversineDistanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

/** A GeoJSON Polygon approximating a `radiusKm` circle centered on (lat, lng) — a naive
 *  pixel-radius circle would be visually wrong at Estonia's latitudes and misleading for a
 *  feature whose whole point is showing the real coverage area. */
export function circlePolygon(lat: number, lng: number, radiusKm: number): GeoJSON.Polygon {
  const coordinates: [number, number][] = [];
  for (let i = 0; i <= CIRCLE_STEPS; i++) {
    coordinates.push(destinationPoint(lat, lng, radiusKm, (360 * i) / CIRCLE_STEPS));
  }
  return { type: "Polygon", coordinates: [coordinates] };
}
