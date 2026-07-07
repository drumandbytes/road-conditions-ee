// Public dev URL for the tiles R2 bucket. Rate-limited, dev/testing only per Cloudflare's
// own docs — swap for a custom domain before real launch (Phase 5 open question: which
// domain to use).
const TILES_BASE = "https://pub-3803bab99e72440281dd3cff58995fbc.r2.dev";

export const WORLD_TILES_URL = `${TILES_BASE}/world-low.pmtiles`;
export const ESTONIA_TILES_URL = `${TILES_BASE}/estonia.pmtiles`;

// Estonia bbox used for the estonia.pmtiles extract (see Phase 0 notes) — used to fit the
// map's initial view.
export const ESTONIA_BOUNDS: [[number, number], [number, number]] = [
  [20.3, 57.5],
  [28.2, 59.7],
];
