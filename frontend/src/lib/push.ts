import { registerPushSubscription, unregisterPushSubscription } from "./api";

// Baked in at build time (a GitHub Actions repo variable, same mechanism as
// VITE_API_BASE_URL) — the public key is meant to be public, unlike VAPID_PRIVATE_KEY which
// stays a Worker secret in ingest-worker. Undefined until that variable is actually set.
const VAPID_PUBLIC_KEY: string | undefined = import.meta.env.VITE_VAPID_PUBLIC_KEY;

// Mirrors the backend's copy so disablePushNotifications can still remove it even once
// pushManager.getSubscription() itself returns null (permission revoked, site data cleared) —
// at that point the browser has no memory of its own former endpoint, so this is the only
// place left to find it.
const PUSH_ENDPOINT_KEY = "road-conditions-push-endpoint";

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

// Brave ships Chromium's Push API but disables the underlying Google push service by
// default (Settings > Privacy > "Use Google services for push messaging") — permission
// prompts and grants normally, but pushManager.subscribe() then fails. navigator.brave is
// Brave's own (unofficial but stable, widely relied upon) self-identification API.
async function isBraveBrowser(): Promise<boolean> {
  const brave = (navigator as Navigator & { brave?: { isBrave: () => Promise<boolean> } }).brave;
  if (!brave) return false;
  try {
    return await brave.isBrave();
  } catch {
    return false;
  }
}

export type EnablePushResult = "ok" | "denied" | "brave-blocked" | "error";

/** Requests notification permission (must be called from an explicit user action, e.g. a
 *  button click — never on page load) and, if granted, subscribes to push and registers the
 *  subscription with the backend. Doesn't throw — callers switch on the result to show the
 *  right state. iOS Safari requires the PWA to be installed to the home screen before push
 *  permission is even offered — a UX step to surface elsewhere, not something this function
 *  can detect or work around. */
export async function enablePushNotifications(): Promise<EnablePushResult> {
  if (!pushSupported()) return "error";

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return "denied";

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
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return "error";
    await registerPushSubscription({
      endpoint: json.endpoint,
      keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
    });
    localStorage.setItem(PUSH_ENDPOINT_KEY, json.endpoint);
    return "ok";
  } catch (err) {
    console.error("Failed to enable push notifications", err);
    return (await isBraveBrowser()) ? "brave-blocked" : "error";
  }
}

/** Reverses enablePushNotifications — unsubscribes the browser's own PushManager subscription
 *  first (the user-facing effect: no more push permission/receipt), then best-effort tells the
 *  backend to remove its copy. A backend-delete failure isn't fatal here — the row is already
 *  harmless once the browser side is gone, and ingest-worker's failure_count-based pruning
 *  cleans up a stale row the next time a send to it fails anyway. */
export async function disablePushNotifications(): Promise<boolean> {
  if (!pushSupported()) return false;
  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    // Falls back to the locally-remembered endpoint when the browser's own subscription is
    // already gone (permission revoked, site data cleared) — getSubscription() returning null
    // means the browser itself no longer knows which endpoint it used to have.
    const endpoint = subscription?.endpoint ?? localStorage.getItem(PUSH_ENDPOINT_KEY);
    if (subscription) await subscription.unsubscribe();
    if (endpoint) {
      try {
        await unregisterPushSubscription(endpoint);
      } catch (err) {
        console.error("Failed to remove push subscription from backend", err);
      }
    }
    localStorage.removeItem(PUSH_ENDPOINT_KEY);
    return true;
  } catch (err) {
    console.error("Failed to disable push notifications", err);
    return false;
  }
}
