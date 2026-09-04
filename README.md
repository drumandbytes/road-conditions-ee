# road-conditions-ee

**Teesilm** — a mobile-first PWA alternative to [tarktee.ee](https://tarktee.ee), Estonia's
official road-conditions tool — same public data (road weather stations, cameras, hazards via
Transpordiamet's Tark Tee DATEX II gateway), rebuilt with a cleaner map and precise
location-based push alerts (a radius around a saved point like home/work, instead of
tarktee.ee's coarse region/road-number email subscription).

Full design/architecture background: see the plan document from the session that built this
(not checked into this repo).

## Structure

- `ingest-worker/` — Cloudflare Worker, Cron Trigger only. Polls Tark Tee every 2 minutes,
  upserts into D1, matches new hazards against saved points, sends Web Push.
- `api-worker/` — Cloudflare Worker, pure API (no static assets). Serves map data to the
  frontend, gates paid routes (camera images, VMS, alerts) behind a Stripe-issued bearer
  token.
- `frontend/` — Vite + Preact + TypeScript PWA, deploys to Cloudflare Pages. Live at
  `roadconditions.drumandbytes.ee` (also reachable at `road-conditions-ee.pages.dev`).
  MapLibre GL JS map, reading self-hosted vector tiles from R2 (no third-party tile API).
- `shared/schema.sql` — single source of truth for the D1 schema (`road-conditions`
  database), applied via `wrangler d1 execute --file=shared/schema.sql --remote`.

## Data source

Public Tark Tee endpoints (weather/camera metadata, weather status) require **no auth**, but
need `Accept-Encoding: identity` on every request — Tark Tee's server has a gzip+chunked-encoding
bug that breaks `fetch()` and `curl` otherwise (confirmed directly against the real Cloudflare
edge). See `ingest-worker/src/tarktee.ts`.

DATEX II SRTI hazard feeds require a registered API key (submitted, pending manual
Transpordiamet review as of writing) — set as `TARKTEE_API_KEY` via `wrangler secret put`
once approved.

## Map tiles

Self-hosted on R2 (`road-conditions-ee-tiles` bucket), a bbox extract of
[Protomaps](https://protomaps.com)' free, open-source OSM planet build: a single
`estonia.pmtiles` file (~313MB, zoom 0–15), served via a custom domain
(`tiles.roadconditions.drumandbytes.ee`) rather than R2's rate-limited/uncached `r2.dev` dev URL.
Rebuilt weekly by `.github/workflows/regenerate-tiles.yml`.

No tile server, no third-party API dependency, no fair-use risk (unlike the raw
`tile.openstreetmap.org` server). No separate world/backdrop tileset — `MAX_PAN_BOUNDS` in
`frontend/src/lib/config.ts` keeps the viewport inside this file's own coverage at every zoom,
so there's nothing outside it left to fill.

## Development

Each project is self-contained:

```
cd ingest-worker && npm install && npm run dev    # or api-worker, frontend
```

Root-level scripts: `npm run lint` (all TS across the repo), `npm run deploy:all`.

## Attribution

Data: Transpordiamet (Tark Tee), per their [terms of use](https://tarktee.ee/#/et/terms).
Map: © OpenStreetMap contributors, via Protomaps.

## License

Source-available, all rights reserved — see [LICENSE](LICENSE). Bug reports and feature
requests are welcome via Issues; see [CONTRIBUTING.md](CONTRIBUTING.md). Found a security
issue? See [SECURITY.md](SECURITY.md) instead of filing a public issue.
