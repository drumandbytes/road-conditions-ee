// Signs/verifies one-click unsubscribe links without requiring the recipient to log in —
// that's the whole point of a one-click unsubscribe (RFC 8058 / common mailbox-provider
// expectations). The signature only covers the user id, not which category is being
// unsubscribed — tampering with the category on an otherwise-valid link can only flip that
// same, already-identified user's own preferences (there's no way to target a different user
// without already possessing a valid signed link for them), so it doesn't need to be part of
// the signed payload.

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

function base64UrlEncode(bytes: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

export async function signUnsubscribeToken(secret: string, userId: string): Promise<string> {
  const key = await hmacKey(secret);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(userId));
  return base64UrlEncode(signature);
}

// Uses crypto.subtle.verify (constant-time internally) rather than recomputing and
// string-comparing — a naive === comparison here would open a timing side-channel an attacker
// could use to forge a valid token for an arbitrary user id.
export async function verifyUnsubscribeToken(secret: string, userId: string, token: string): Promise<boolean> {
  let signatureBytes: Uint8Array;
  try {
    signatureBytes = base64UrlDecode(token);
  } catch {
    return false;
  }
  const key = await hmacKey(secret);
  return crypto.subtle.verify("HMAC", key, signatureBytes, new TextEncoder().encode(userId));
}

// api-worker's own custom domain, not the frontend's — /api/unsubscribe is served by this
// Worker, and only this Worker (see api-worker/wrangler.toml's routes).
const API_BASE_URL = "https://api.drumandbytes.ee";

/** Builds the one-click unsubscribe link for a specific category, embedded in the footer of
 *  billing/service-announcement emails (see emailTemplate.ts's callers). */
export async function buildUnsubscribeLink(
  secret: string,
  userId: string,
  category: "productUpdates" | "serviceAnnouncements" | "billing",
): Promise<string> {
  const sig = await signUnsubscribeToken(secret, userId);
  return `${API_BASE_URL}/api/unsubscribe?uid=${encodeURIComponent(userId)}&sig=${encodeURIComponent(sig)}&category=${category}`;
}
