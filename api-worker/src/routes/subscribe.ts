import type { UserRow } from "../db";

/** Paid tier (Phase 4): save a point (home/work/etc) + Web Push subscription. Not
 *  implemented yet — depends on Phase 3's user/bearer-token system being live first. */
export async function handleSubscribe(_request: Request, _db: D1Database, user: UserRow | null): Promise<Response> {
  if (!user) {
    return Response.json({ error: "Saved-point alerts require an active subscription" }, { status: 402 });
  }
  return Response.json({ error: "Not implemented yet — Phase 4 work" }, { status: 501 });
}

export async function handleUnsubscribe(_pointId: string, _db: D1Database, user: UserRow | null): Promise<Response> {
  if (!user) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  return Response.json({ error: "Not implemented yet — Phase 4 work" }, { status: 501 });
}
