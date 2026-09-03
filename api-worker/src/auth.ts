import { getUserByBearerToken, type UserRow } from "./db";

function extractBearerToken(request: Request): string | null {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice("Bearer ".length).trim();
  return token || null;
}

// Every paid route starts with a bearer-token → user D1 read. Polling clients (an open camera
// modal, layer refreshes) hit the same warm isolate repeatedly, so a short-lived per-isolate
// memo cuts that read. Only *paid* users are cached — a not-found or free-tier lookup is never
// stored, so a free→paid upgrade takes effect on the very next request. Worst case: a
// portal-cancelled subscription keeps working for up to AUTH_CACHE_TTL_MS in one isolate.
const AUTH_CACHE_TTL_MS = 30_000;
const authCache = new Map<string, { user: UserRow; expires: number }>();

/** Drop a token from the memo — call after anything that invalidates it server-side, e.g.
 *  account deletion. */
export function evictAuthCache(token: string): void {
  authCache.delete(token);
}

/** Extracts and validates the bearer token from an Authorization header, returning the
 *  associated user if valid and on the paid tier, or null otherwise. Never throws — callers
 *  should treat null as "not authorized" and respond 401/402 as appropriate. */
export async function authenticatePaidUser(
  db: D1Database,
  request: Request,
): Promise<UserRow | null> {
  const token = extractBearerToken(request);
  if (!token) return null;

  const cached = authCache.get(token);
  if (cached && cached.expires > Date.now()) return cached.user;

  const user = await getUserByBearerToken(db, token);
  if (!user || (user.subscription_status !== "active" && user.subscription_status !== "lifetime")) return null;
  authCache.set(token, { user, expires: Date.now() + AUTH_CACHE_TTL_MS });
  return user;
}

/** Same token validation as authenticatePaidUser but without the subscription-status gate —
 *  for actions that must work regardless of paid/free/canceled status, like account deletion.
 *  A canceled subscriber still owns their account and its data, and still has every right to
 *  delete it; authenticatePaidUser would incorrectly treat them as unauthenticated. */
export async function authenticateUser(db: D1Database, request: Request): Promise<UserRow | null> {
  const token = extractBearerToken(request);
  if (!token) return null;
  return getUserByBearerToken(db, token);
}
