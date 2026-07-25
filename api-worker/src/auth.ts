import { getUserByBearerToken, type UserRow } from "./db";

function extractBearerToken(request: Request): string | null {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice("Bearer ".length).trim();
  return token || null;
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

  const user = await getUserByBearerToken(db, token);
  if (!user || (user.subscription_status !== "active" && user.subscription_status !== "lifetime")) return null;
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
