import type { SavedPointRow, UserRow } from "../db";
import { createSavedPoint, deleteSavedPoint, getSavedPointsByUser } from "../db";

const MAX_LABEL_LENGTH = 60;
const MIN_RADIUS_KM = 0.5;
const MAX_RADIUS_KM = 50;
// Estonia's bounding box, generously padded — rejects obviously-wrong coordinates (a typo'd
// geocode result, a client bug), not an exact-country check.
const LAT_RANGE: [number, number] = [56, 60];
const LNG_RANGE: [number, number] = [20, 29];

interface SavedPointBody {
  label: string;
  lat: number;
  lng: number;
  radiusKm: number;
  eventTypes: string[] | null;
}

// Deliberately not validated against a fixed enum — alert categories are the union of
// hazard event_types and restriction effects, and new ones can appear upstream without a
// backend deploy. Structural validation (non-empty strings) is enough; the frontend's picker
// is what constrains a user to real, known categories.
function isValidEventTypes(value: unknown): value is string[] | null {
  if (value === null || value === undefined) return true;
  return Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === "string" && v.length > 0);
}

function parseSavedPointBody(body: unknown): SavedPointBody | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;

  const label = typeof b.label === "string" ? b.label.trim() : "";
  if (!label || label.length > MAX_LABEL_LENGTH) return null;

  if (typeof b.lat !== "number" || !Number.isFinite(b.lat) || b.lat < LAT_RANGE[0] || b.lat > LAT_RANGE[1]) return null;
  if (typeof b.lng !== "number" || !Number.isFinite(b.lng) || b.lng < LNG_RANGE[0] || b.lng > LNG_RANGE[1]) return null;

  const radiusKm = typeof b.radiusKm === "number" && Number.isFinite(b.radiusKm) ? b.radiusKm : 5;
  if (radiusKm < MIN_RADIUS_KM || radiusKm > MAX_RADIUS_KM) return null;

  if (!isValidEventTypes(b.eventTypes)) return null;

  return { label, lat: b.lat, lng: b.lng, radiusKm, eventTypes: (b.eventTypes as string[] | null) ?? null };
}

function toSavedPointJson(row: SavedPointRow) {
  return {
    id: row.id,
    label: row.label,
    lat: row.lat,
    lng: row.lng,
    radiusKm: row.radius_km,
    eventTypes: row.event_types ? (JSON.parse(row.event_types) as string[]) : null,
  };
}

export async function handleListSavedPoints(db: D1Database, user: UserRow | null): Promise<Response> {
  if (!user) {
    return Response.json({ error: "Saved-point alerts require an active subscription" }, { status: 402 });
  }
  const points = await getSavedPointsByUser(db, user.id);
  return Response.json(points.map(toSavedPointJson));
}

export async function handleSubscribe(request: Request, db: D1Database, user: UserRow | null): Promise<Response> {
  if (!user) {
    return Response.json({ error: "Saved-point alerts require an active subscription" }, { status: 402 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = parseSavedPointBody(body);
  if (!parsed) {
    return Response.json({ error: "Invalid saved point" }, { status: 400 });
  }

  const row = await createSavedPoint(db, { userId: user.id, ...parsed });
  return Response.json(toSavedPointJson(row), { status: 201 });
}

export async function handleUnsubscribe(pointId: string, db: D1Database, user: UserRow | null): Promise<Response> {
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const id = Number(pointId);
  if (!Number.isInteger(id)) {
    return Response.json({ error: "Invalid id" }, { status: 400 });
  }
  const deleted = await deleteSavedPoint(db, id, user.id);
  if (!deleted) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return new Response(null, { status: 204 });
}
