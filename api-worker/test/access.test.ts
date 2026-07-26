import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyAccessJwt } from "../src/access";

const TEAM_DOMAIN = "https://drumandbytes.cloudflareaccess.com";
const AUD = "test-application-aud-tag";

// Real generated keys, a real signed JWT, and a real (mocked-transport) JWKS fetch — not just
// trusting jose's library calls blindly, since this is the one thing standing between the
// internet and the admin routes.
// Unique kid per call — access.ts caches the JWKS wrapper at module scope (deliberately, to
// avoid reconstructing it every request in production), which persists across tests in this
// file. A reused kid could hit that cache with stale key material from an earlier test;
// a fresh kid every time guarantees each test's fetch mock is what actually gets used.
let kidCounter = 0;
async function makeKeyPairAndJwks() {
  const { privateKey, publicKey } = await generateKeyPair("RS256", { extractable: true });
  const jwk = await exportJWK(publicKey);
  const kid = `test-key-${++kidCounter}`;
  jwk.kid = kid;
  jwk.alg = "RS256";
  return { privateKey, kid, jwks: { keys: [jwk] } };
}

function makeRequest(token?: string): Request {
  const headers = new Headers();
  if (token) headers.set("Cf-Access-Jwt-Assertion", token);
  return new Request("https://api.drumandbytes.ee/api/admin/stats", { headers });
}

describe("access.ts", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the email from a valid Access JWT", async () => {
    const { privateKey, kid, jwks } = await makeKeyPairAndJwks();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => jwks, headers: new Headers() }),
    );
    const token = await new SignJWT({ email: "maris@popens.lv" })
      .setProtectedHeader({ alg: "RS256", kid })
      .setIssuer(TEAM_DOMAIN)
      .setAudience(AUD)
      .setExpirationTime("15m")
      .sign(privateKey);

    const email = await verifyAccessJwt(makeRequest(token), AUD);

    expect(email).toBe("maris@popens.lv");
  });

  it("returns null with no Cf-Access-Jwt-Assertion header", async () => {
    const email = await verifyAccessJwt(makeRequest(), AUD);
    expect(email).toBeNull();
  });

  it("returns null when ACCESS_AUD isn't configured", async () => {
    const email = await verifyAccessJwt(makeRequest("some-token"), undefined);
    expect(email).toBeNull();
  });

  it("rejects a token signed for a different application (wrong audience)", async () => {
    const { privateKey, kid, jwks } = await makeKeyPairAndJwks();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => jwks, headers: new Headers() }),
    );
    const token = await new SignJWT({ email: "maris@popens.lv" })
      .setProtectedHeader({ alg: "RS256", kid })
      .setIssuer(TEAM_DOMAIN)
      .setAudience("some-other-applications-aud-tag")
      .setExpirationTime("15m")
      .sign(privateKey);

    const email = await verifyAccessJwt(makeRequest(token), AUD);

    expect(email).toBeNull();
  });

  it("rejects an expired token", async () => {
    const { privateKey, kid, jwks } = await makeKeyPairAndJwks();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => jwks, headers: new Headers() }),
    );
    const token = await new SignJWT({ email: "maris@popens.lv" })
      .setProtectedHeader({ alg: "RS256", kid })
      .setIssuer(TEAM_DOMAIN)
      .setAudience(AUD)
      .setIssuedAt(Math.floor(Date.now() / 1000) - 3600)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 1800)
      .sign(privateKey);

    const email = await verifyAccessJwt(makeRequest(token), AUD);

    expect(email).toBeNull();
  });

  it("rejects a token signed by a key not present in the JWKS (forged/untrusted signer)", async () => {
    const { kid, jwks } = await makeKeyPairAndJwks(); // real JWKS, but token below is signed by a *different* key
    const { privateKey: attackerKey } = await generateKeyPair("RS256", { extractable: true });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => jwks, headers: new Headers() }),
    );
    const token = await new SignJWT({ email: "attacker@example.com" })
      .setProtectedHeader({ alg: "RS256", kid })
      .setIssuer(TEAM_DOMAIN)
      .setAudience(AUD)
      .setExpirationTime("15m")
      .sign(attackerKey);

    const email = await verifyAccessJwt(makeRequest(token), AUD);

    expect(email).toBeNull();
  });
});
