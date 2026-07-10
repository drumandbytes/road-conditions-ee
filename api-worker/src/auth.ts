import { getUserByBearerToken, type UserRow } from "./db";

/** Extracts and validates the bearer token from an Authorization header, returning the
 *  associated user if valid and on the paid tier, or null otherwise. Never throws — callers
 *  should treat null as "not authorized" and respond 401/402 as appropriate. */
export async function authenticatePaidUser(
  db: D1Database,
  request: Request,
): Promise<UserRow | null> {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;
  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) return null;

  const user = await getUserByBearerToken(db, token);
  if (!user || (user.subscription_status !== "active" && user.subscription_status !== "lifetime")) return null;
  return user;
}
