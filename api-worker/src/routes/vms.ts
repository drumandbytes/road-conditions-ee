import type { UserRow } from "../db";

/** Paid tier (Phase 4): live electronic road sign (VMS) content. Not implemented yet —
 *  ingestion of vms_signs table happens in ingest-worker as part of Phase 4, once the
 *  DATEX II API key is active and this feed is wired into the poll cycle. */
export async function handleVms(_db: D1Database, user: UserRow | null): Promise<Response> {
  if (!user) {
    return Response.json({ error: "VMS board data requires an active subscription" }, { status: 402 });
  }
  return Response.json({ error: "Not implemented yet — Phase 4 work" }, { status: 501 });
}
