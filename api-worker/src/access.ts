import { createRemoteJWKSet, jwtVerify } from "jose";

// Defense-in-depth, not the primary gate — Cloudflare Access already blocks unauthenticated
// requests to /api/admin/* at the edge (see the "Teesilm Admin" self-hosted Access
// application), before they ever reach this Worker. This re-verifies the JWT Access attaches
// to every request it lets through, so a misconfigured or since-removed Access policy doesn't
// silently leave these routes open — this Worker enforces its own authorization regardless of
// what the edge is currently configured to do.

const ACCESS_TEAM_DOMAIN = "https://drumandbytes.cloudflareaccess.com";

// Cached across requests within the same isolate — createRemoteJWKSet handles its own internal
// caching/refetching of the actual key set, so this just avoids reconstructing the JWKSet
// wrapper itself on every request.
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwks() {
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`));
  }
  return jwks;
}

/** Verifies the Cf-Access-Jwt-Assertion header Cloudflare Access attaches to every request it
 *  authorizes. Returns the authenticated user's email on success, or null on any failure
 *  (missing header, bad signature, wrong audience, expired) — callers should treat null as
 *  "not authorized" and respond 401. `accessAud` is the "Teesilm Admin" Access application's
 *  own Application Audience (AUD) tag (Access → Applications → Teesilm Admin → Overview) — not
 *  a secret, just an identifier scoping verification to this specific application. */
export async function verifyAccessJwt(request: Request, accessAud: string | undefined): Promise<string | null> {
  if (!accessAud) return null;
  const token = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, getJwks(), {
      issuer: ACCESS_TEAM_DOMAIN,
      audience: accessAud,
    });
    return typeof payload.email === "string" ? payload.email : null;
  } catch (err) {
    console.error("[api-worker] Access JWT verification failed:", err instanceof Error ? err.message : err);
    return null;
  }
}
