// Web Push sending, via the `web-push` npm package (Node's `crypto`, enabled by the
// `nodejs_compat` flag in wrangler.toml). Verified directly — see that flag's comment in
// wrangler.toml — that this works on this project's compatibility_date, using the modern
// RFC 8291 `aes128gcm` encoding, despite an open GitHub issue claiming Workers compatibility
// problems on older runtime versions.
import webpush from "web-push";

// A URL identifying the sender, per the VAPID spec (RFC 8292) — required by web-push's
// setVapidDetails, shown to push-service operators if they need to contact the sender about
// abuse. Deliberately the site's own URL, not a personal email address.
const VAPID_SUBJECT = "https://roadconditions.drumandbytes.ee";

export interface PushSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushPayload {
  title: string;
  body: string;
  url: string;
}

export interface PushResult {
  success: boolean;
  statusCode?: number;
}

/** Sends one Web Push message. Never throws — RFC 8030 response codes are translated into
 *  `PushResult` so the caller (see notify.ts) can decide what to do with the subscription
 *  (delete on 404/410, leave alone on 429, count toward failure_count on 5xx, etc.) without
 *  needing to know anything about web-push's own error shape. */
export async function sendWebPush(
  subscription: PushSubscription,
  payload: PushPayload,
  vapidPublicKey: string,
  vapidPrivateKey: string,
): Promise<PushResult> {
  try {
    // Inside the try, not before it — a malformed VAPID key (e.g. pasted wrong via `wrangler
    // secret put`) throws synchronously here, and this function's contract (see doc comment
    // above) is that it never throws.
    webpush.setVapidDetails(VAPID_SUBJECT, vapidPublicKey, vapidPrivateKey);
    await webpush.sendNotification(
      { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
      JSON.stringify(payload),
    );
    return { success: true, statusCode: 201 };
  } catch (err) {
    const statusCode =
      err && typeof err === "object" && "statusCode" in err && typeof err.statusCode === "number"
        ? err.statusCode
        : undefined;
    console.error(
      `[ingest-worker] push send failed (endpoint=${subscription.endpoint}, status=${statusCode}):`,
      err instanceof Error ? err.message : err,
    );
    return { success: false, statusCode };
  }
}
