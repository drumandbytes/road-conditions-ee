import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [preact()],
  build: {
    rollupOptions: {
      // Multi-page build — the admin panel is a deliberately separate, small bundle (its own
      // entry point and output files) rather than a route inside the main app, so it doesn't
      // bloat the public app's JS with admin-only code. admin/index.html (not admin.html at
      // the root) so Cloudflare Pages serves it at /admin via its native directory-index
      // behavior (same as / → index.html) — a _redirects rewrite rule was tried first, but it
      // caused an infinite redirect loop with Cloudflare Access, whose destination path
      // pattern (/admin*) also matched the rewrite's internal target and re-triggered on it.
      input: {
        main: resolve(__dirname, 'index.html'),
        admin: resolve(__dirname, 'admin/index.html'),
      },
    },
  },
})
