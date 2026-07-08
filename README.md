# road-conditions-ee

A mobile-first PWA alternative to [tarktee.ee](https://tarktee.ee), Estonia's official road-conditions
tool — same public data (road weather stations, cameras, hazards via Transpordiamet's Tark Tee
DATEX II gateway), rebuilt with a cleaner map and precise location-based push alerts (a radius
around a saved point like home/work, instead of tarktee.ee's coarse region/road-number email
subscription).

Full design/architecture background: see the plan document from the session that built this
(not checked into this repo).

## Structure

- `ingest-worker/` — Cloudflare Worker, Cron Trigger only. Polls Tark Tee every 2 minutes,
  upserts into D1, matches new hazards against saved points, sends Web Push (Phase 4).
- `api-worker/` — Cloudflare Worker, pure API (no static assets). Serves map data to the
  frontend, gates paid routes (camera images, VMS, alerts) behind a Stripe-issued bearer
  token (Phase 3+).
- `frontend/` — Vite + Preact + TypeScript PWA, deploys to Cloudflare Pages. Live at
  `roadconditions.drumandbytes.ee` (also reachable at `road-conditions-ee.pages.dev`).
  MapLibre GL JS map (Phase 2), reading self-hosted vector tiles from R2 (no third-party
  tile API).
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

Self-hosted on R2 (`road-conditions-ee-tiles` bucket), built from
[Protomaps](https://protomaps.com)' free, open-source daily OSM basemap:
- `world-low.pmtiles` (43MB, zoom 0–6) — global backdrop so panning outside Estonia never
  shows blank/black.
- `estonia.pmtiles` (266MB, zoom 0–15) — full detail within Estonia's bounds.

No tile server, no third-party API dependency, no fair-use risk (unlike the raw
`tile.openstreetmap.org` server).

## Development

Each project is self-contained:

```
cd ingest-worker && npm install && npm run dev    # or api-worker, frontend
```

Root-level scripts: `npm run lint` (all TS across the repo), `npm run deploy:all`.

## Attribution

Data: Transpordiamet (Tark Tee), per their [terms of use](https://tarktee.ee/#/et/terms).
Map: © OpenStreetMap contributors, via Protomaps.
