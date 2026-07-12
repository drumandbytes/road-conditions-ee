// Plain static file (not Vite-built) — deliberately skips vite-plugin-pwa and offline
// precaching, neither of which this app needs. What Chrome's installability criteria
// actually require: manual install (browser menu) just needs *a* registered service worker,
// no fetch handler, since Chrome 108/112; the automatic install-prompt banner still wants one
// present, hence the trivial passthrough below.
self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});

// Push handling — implemented in the push-alerts feature, not this PWA-installability pass.
self.addEventListener("push", (_event) => {
  // TODO: self.registration.showNotification(...)
});

self.addEventListener("notificationclick", (_event) => {
  // TODO: focus/open the app to the relevant map location
});
