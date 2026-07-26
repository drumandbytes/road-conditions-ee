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
      // bloat the public app's JS with admin-only code. Cloudflare Pages serves admin.html at
      // /admin via public/_redirects (a rewrite, not a redirect, so the URL bar stays /admin).
      input: {
        main: resolve(__dirname, 'index.html'),
        admin: resolve(__dirname, 'admin.html'),
      },
    },
  },
})
