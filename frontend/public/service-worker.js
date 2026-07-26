// Plain static file (not Vite-built) — deliberately skips vite-plugin-pwa and offline
// precaching, neither of which this app needs. What Chrome's installability criteria
// actually require: manual install (browser menu) just needs *a* registered service worker,
// no fetch handler, since Chrome 108/112; the automatic install-prompt banner still wants one
// present, hence the trivial passthrough below.
//
// Navigations must NOT be intercepted, though — confirmed in production: this SW's default
// scope (/) covers /admin too, and re-issuing a navigation via fetch(event.request) inside a
// service worker doesn't complete Cloudflare Access's multi-hop GitHub OAuth redirect chain
// the same way a real top-level browser navigation does, causing an infinite redirect loop
// (ERR_TOO_MANY_REDIRECTS, every request in the chain initiated by this very script). Only
// intercept non-navigation fetches, which is all the "just needs to exist" passthrough below
// was ever for anyway.
self.addEventListener("fetch", (event) => {
  if (event.request.mode === "navigate") return;
  event.respondWith(fetch(event.request));
});

// Payload shape matches ingest-worker's PushPayload (src/push.ts) exactly — {title, body, url}
// as a JSON string, since Web Push data is opaque bytes with no schema of its own.
self.addEventListener("push", (event) => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    return; // malformed payload — nothing sensible to show, don't crash the SW over it
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/icon-192.png",
      data: { url: payload.url },
    }),
  );
});

// Focuses an already-open tab on this origin if one exists, rather than always opening a new
// one — a user who already has the app open shouldn't end up with two tabs after tapping a
// notification.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? self.registration.scope;

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if (client.url === url && "focus" in client) return client.focus();
      }
      return self.clients.openWindow(url);
    }),
  );
});
