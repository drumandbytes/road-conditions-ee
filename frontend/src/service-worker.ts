// Custom service worker — Phase 2 (app-shell caching) / Phase 4 (push handling) work.
//
// Plan: app-shell caching for offline support (Phase 2), plus `push` and
// `notificationclick` event listeners once Web Push ships (Phase 4). Not wired into the
// build yet — will use vite-plugin-pwa's `injectManifest` strategy so this file stays
// hand-written (for the custom push logic) while the plugin injects the precache manifest.

self.addEventListener("push", (_event) => {
  // TODO Phase 4: self.registration.showNotification(...)
});

self.addEventListener("notificationclick", (_event) => {
  // TODO Phase 4: focus/open the app to the relevant map location
});
