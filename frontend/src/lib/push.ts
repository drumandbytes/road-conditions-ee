// Web Push subscription flow — Phase 4 work (paid tier), not implemented yet.
//
// Plan: request Notification permission, call PushManager.subscribe() with the VAPID
// public key (baked in at build time via an env var, safe to expose), POST the resulting
// subscription + a saved point to /api/subscribe. iOS Safari requires the PWA to be
// installed to the home screen first — push silently won't work otherwise, a UX step to
// surface to the user, not just a implementation detail.

export async function subscribeToPush(): Promise<never> {
  throw new Error("subscribeToPush not implemented yet — Phase 4 work, see comment above");
}
