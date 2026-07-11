// Custom domain for the tiles R2 bucket (Phase 5 item, done) — puts Cloudflare's cache in
// front of R2, fixing the tile-loading lag the old r2.dev public dev URL had (that URL is
// explicitly rate-limited/uncached per Cloudflare's own docs, dev/testing only).
const TILES_BASE = "https://tiles.roadconditions.drumandbytes.ee";

export const ESTONIA_TILES_URL = `${TILES_BASE}/estonia.pmtiles`;

// Estonia bbox used to fit the map's initial view. Kept inside MAX_PAN_BOUNDS below with
// margin — west edge sits just past Vilsandi/Sõrve (Saaremaa's westernmost points), the
// other three sides just past Estonia's actual extreme points (Vaindloo island 59.82°N
// north, Narva 28.21°E east, a farmstead at Mõniste 57.51°N south — verified against
// en.wikipedia.org/wiki/Extreme_points_of_Estonia, not assumed from memory).
export const ESTONIA_BOUNDS: [[number, number], [number, number]] = [
  [21.3, 57.5],
  [28.2, 59.7],
];

// Hard pan limit, kept a small margin inside estonia.pmtiles' actual extract bbox
// (20.9,57.4 to 28.35,59.9) — originally added as a workaround for a MapLibre bug
// (github.com/maplibre/maplibre-gl-js/issues/5692, "incorrect handling of missing tiles with
// uneven source coverage") that showed up when panning past a detailed source's bbox edge
// into an area only a coarser backdrop source covered. Once this existed, the backdrop
// source (and its own bbox/zoom coverage) became unnecessary — the viewport can never reach
// outside estonia.pmtiles' own coverage now, at any zoom, so there's nothing left for a
// second source to fill. Kept intentionally tight to Estonia's real extreme points plus a
// small comfortable margin (not a wide buffer into neighboring countries) — no product
// reason for this Estonia-focused app to let users pan into Finland/Russia/Latvia, and it
// keeps the tile archive small (406MB → 313MB from this pass alone; north/east/south all had
// real, non-empty content being trimmed here, unlike the west edge which was mostly empty
// sea). Must stay inside estonia.pmtiles' own bbox above (with margin), and ESTONIA_BOUNDS
// above must stay inside *this* box, or fitBounds/maxBounds fight each other.
export const MAX_PAN_BOUNDS: [[number, number], [number, number]] = [
  [21.0, 57.45],
  [28.3, 59.85],
];
