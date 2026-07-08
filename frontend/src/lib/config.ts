// Custom domain for the tiles R2 bucket (Phase 5 item, done) — puts Cloudflare's cache in
// front of R2, fixing the tile-loading lag the old r2.dev public dev URL had (that URL is
// explicitly rate-limited/uncached per Cloudflare's own docs, dev/testing only).
const TILES_BASE = "https://tiles.roadconditions.drumandbytes.ee";

export const WORLD_TILES_URL = `${TILES_BASE}/world-low.pmtiles`;
export const ESTONIA_TILES_URL = `${TILES_BASE}/estonia.pmtiles`;

// Estonia bbox used for the estonia.pmtiles extract (see Phase 0 notes) — used to fit the
// map's initial view.
export const ESTONIA_BOUNDS: [[number, number], [number, number]] = [
  [20.3, 57.5],
  [28.2, 59.7],
];
