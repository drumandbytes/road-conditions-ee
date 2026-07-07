// Web Push sending — Phase 4 work (paid tier), not wired up yet.
//
// Plan: generate a VAPID keypair once, store the private key as a Worker secret
// (`wrangler secret put VAPID_PRIVATE_KEY`), bake the public key into frontend JS.
// Needs a Workers-compatible Web Push library (verify `@block65/webcrypto-web-push` or
// similar — Node's `web-push` npm package assumes Node's `crypto` module, which Workers'
// runtime does not provide; Workers only has the standard WebCrypto API).
//
// Left as a stub so ingest-worker's scheduled handler has a stable import to wire up later
// without restructuring the rest of the poll cycle.

export interface PushSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export async function sendWebPush(
  _subscription: PushSubscription,
  _payload: { title: string; body: string; url: string },
  _vapidPrivateKey: string,
): Promise<{ success: boolean; statusCode?: number }> {
  throw new Error("sendWebPush not implemented yet — Phase 4 work, see comment above");
}
