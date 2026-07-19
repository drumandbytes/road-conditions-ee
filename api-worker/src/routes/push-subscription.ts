import type { UserRow } from "../db";
import { deletePushSubscription, upsertPushSubscription } from "../db";

interface PushSubscriptionBody {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

function parsePushSubscriptionBody(body: unknown): PushSubscriptionBody | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  if (typeof b.endpoint !== "string" || !b.endpoint.startsWith("https://")) return null;
  const keys = b.keys as Record<string, unknown> | undefined;
  if (!keys || typeof keys.p256dh !== "string" || typeof keys.auth !== "string") return null;
  return { endpoint: b.endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}

/** Paid tier: registers or refreshes this device's Web Push subscription for the current
 *  user. A separate resource from saved points (POST /api/subscribe) — a user has one or
 *  more saved points but a push subscription is per-device/per-browser, upserted by
 *  endpoint (see db.ts's upsertPushSubscription). */
export async function handlePushSubscription(
  request: Request,
  db: D1Database,
  user: UserRow | null,
): Promise<Response> {
  if (!user) {
    return Response.json({ error: "Push alerts require an active subscription" }, { status: 402 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = parsePushSubscriptionBody(body);
  if (!parsed) {
    return Response.json({ error: "Invalid push subscription" }, { status: 400 });
  }

  await upsertPushSubscription(db, {
    userId: user.id,
    endpoint: parsed.endpoint,
    p256dh: parsed.keys.p256dh,
    auth: parsed.keys.auth,
  });
  return new Response(null, { status: 204 });
}

/** Lets a user turn push alerts back off — the frontend calls this right after unsubscribing
 *  the browser's own PushManager subscription, so both sides (browser + backend) agree it's
 *  gone rather than leaving an orphaned row an ended subscription can never reach again. */
export async function handleDeletePushSubscription(
  request: Request,
  db: D1Database,
  user: UserRow | null,
): Promise<Response> {
  if (!user) {
    return Response.json({ error: "Push alerts require an active subscription" }, { status: 402 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const endpoint = (body as Record<string, unknown> | null)?.endpoint;
  if (typeof endpoint !== "string" || !endpoint) {
    return Response.json({ error: "Missing endpoint" }, { status: 400 });
  }

  await deletePushSubscription(db, user.id, endpoint);
  return new Response(null, { status: 204 });
}
