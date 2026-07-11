// Custom domain for the tiles R2 bucket (Phase 5 item, done) — puts Cloudflare's cache in
// front of R2, fixing the tile-loading lag the old r2.dev public dev URL had (that URL is
// explicitly rate-limited/uncached per Cloudflare's own docs, dev/testing only).
const TILES_BASE = "https://tiles.roadconditions.drumandbytes.ee";

export const ESTONIA_TILES_URL = `${TILES_BASE}/estonia.pmtiles`;

// Estonia bbox used for the estonia.pmtiles extract (see Phase 0 notes) — used to fit the
// map's initial view.
export const ESTONIA_BOUNDS: [[number, number], [number, number]] = [
  [20.3, 57.5],
  [28.2, 59.7],
];

// Hard pan limit, kept a small margin inside estonia.pmtiles' actual extract bbox
// (19.9,57.1 to 28.6,60.1) — originally added as a workaround for a MapLibre bug
// (github.com/maplibre/maplibre-gl-js/issues/5692, "incorrect handling of missing tiles with
// uneven source coverage") that showed up when panning past a detailed source's bbox edge
// into an area only a coarser backdrop source covered. Once this existed, the backdrop
// source (and its own bbox/zoom coverage) became unnecessary — the viewport can never reach
// outside estonia.pmtiles' own coverage now, at any zoom, so there's nothing left for a
// second source to fill. Kept intentionally tight to Estonia plus a small comfortable
// margin (not a wide buffer into neighboring countries) — no product reason for this
// Estonia-focused app to let users pan to Riga or St. Petersburg, and it keeps the tile
// archive small.
export const MAX_PAN_BOUNDS: [[number, number], [number, number]] = [
  [20.0, 57.2],
  [28.5, 60.0],
];
