import { getEmailPreferences, updateEmailPreferences } from "../db";
import type { EmailPreferences, UserRow } from "../db";

function toApiShape(prefs: EmailPreferences) {
  return { productUpdates: prefs.productUpdates, serviceAnnouncements: prefs.serviceAnnouncements, billing: prefs.billing };
}

export async function handleGetEmailPreferences(db: D1Database, user: UserRow | null): Promise<Response> {
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });
  const prefs = await getEmailPreferences(db, user.id);
  return Response.json(toApiShape(prefs));
}

function parsePatch(body: unknown): Partial<EmailPreferences> | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  const patch: Partial<EmailPreferences> = {};
  for (const key of ["productUpdates", "serviceAnnouncements", "billing"] as const) {
    if (key in b) {
      if (typeof b[key] !== "boolean") return null;
      patch[key] = b[key];
    }
  }
  return patch;
}

export async function handleUpdateEmailPreferences(request: Request, db: D1Database, user: UserRow | null): Promise<Response> {
  if (!user) return Response.json({ error: "Not authenticated" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const patch = parsePatch(body);
  if (!patch) return Response.json({ error: "Invalid preferences" }, { status: 400 });

  const prefs = await updateEmailPreferences(db, user.id, patch);
  return Response.json(toApiShape(prefs));
}
