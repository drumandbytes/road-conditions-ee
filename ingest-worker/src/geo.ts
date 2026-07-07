const EARTH_RADIUS_KM = 6371;

/** Great-circle distance between two lat/lng points, in kilometers. */
export function haversineDistanceKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

export interface SavedPoint {
  id: number;
  lat: number;
  lng: number;
  radiusKm: number;
  eventTypes: string[] | null; // null = all types
}

export interface HazardLocation {
  lat: number;
  lng: number;
  eventType: string;
}

/** Which saved points a given hazard falls within range of (and should notify). */
export function matchingSavedPoints(
  hazard: HazardLocation,
  points: SavedPoint[],
): SavedPoint[] {
  return points.filter((point) => {
    if (point.eventTypes && !point.eventTypes.includes(hazard.eventType)) {
      return false;
    }
    return haversineDistanceKm(hazard.lat, hazard.lng, point.lat, point.lng) <= point.radiusKm;
  });
}
