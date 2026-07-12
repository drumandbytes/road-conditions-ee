import { registerPushSubscription } from "./api";

// Baked in at build time (a GitHub Actions repo variable, same mechanism as
// VITE_API_BASE_URL) — the public key is meant to be public, unlike VAPID_PRIVATE_KEY which
// stays a Worker secret in ingest-worker. Undefined until that variable is actually set.
const VAPID_PUBLIC_KEY: string | undefined = import.meta.env.VITE_VAPID_PUBLIC_KEY;

// pushManager.subscribe wants applicationServerKey as a raw Uint8Array, not the base64url
// string VAPID keys are normally shared as — standard conversion, no library needed for it.
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

export function pushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && Boolean(VAPID_PUBLIC_KEY);
}

/** True once the browser has both granted notification permission AND actually holds a live
 *  push subscription — either alone isn't enough (permission can be granted with no
 *  subscription yet, e.g. right after a service worker update). */
export async function hasActivePushSubscription(): Promise<boolean> {
  if (!pushSupported() || Notification.permission !== "granted") return false;
  const registration = await navigator.serviceWorker.ready;
  const subscription = await registration.pushManager.getSubscription();
  return subscription !== null;
}

/** Requests notification permission (must be called from an explicit user action, e.g. a
 *  button click — never on page load) and, if granted, subscribes to push and registers the
 *  subscription with the backend. Returns false on any failure (permission denied, subscribe
 *  failed, registration failed) without throwing — callers show one generic error state
 *  either way, since the specific reason isn't actionable for the user. iOS Safari requires
 *  the PWA to be installed to the home screen before push permission is even offered — a UX
 *  step to surface elsewhere, not something this function can detect or work around. */
export async function enablePushNotifications(): Promise<boolean> {
  if (!pushSupported()) return false;

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return false;

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      // Cast needed because of a lib.dom.d.ts/TS-version mismatch: Uint8Array is generic over
      // ArrayBufferLike (which includes SharedArrayBuffer) while BufferSource's
      // ArrayBufferView requires a plain ArrayBuffer specifically — the value itself is a
      // real, correctly-shaped Uint8Array at runtime regardless.
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY!) as BufferSource,
    });
    const json = subscription.toJSON();
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return false;
    await registerPushSubscription({
      endpoint: json.endpoint,
      keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
    });
    return true;
  } catch (err) {
    console.error("Failed to enable push notifications", err);
    return false;
  }
}
