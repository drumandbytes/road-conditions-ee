CREATE TABLE users (
  id TEXT PRIMARY KEY,                    -- random opaque ID, not sequential
  email TEXT UNIQUE,
  stripe_customer_id TEXT,
  subscription_status TEXT NOT NULL DEFAULT 'free',  -- 'free' | 'active' | 'canceled' | 'lifetime'
                                          -- 'lifetime' = manually granted (self, chosen people)
                                          -- via a direct row update, deliberately never sold —
                                          -- see checkout.ts for why. No Stripe subscription
                                          -- object exists for these users, so no
                                          -- customer.subscription.* webhook can ever downgrade
                                          -- them automatically.
  bearer_token TEXT UNIQUE,                -- opaque, random; sent as Authorization: Bearer
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
-- SQLite allows multiple NULLs through a UNIQUE index (only non-NULL values are compared),
-- so this doesn't block rows that haven't gone through Stripe yet. Required for the
-- ON CONFLICT(stripe_customer_id) upsert in api-worker's checkout/webhook handlers.
CREATE UNIQUE INDEX idx_users_stripe_customer_id ON users(stripe_customer_id);

CREATE TABLE push_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  failure_count INTEGER NOT NULL DEFAULT 0   -- for pruning dead subscriptions
);

CREATE TABLE saved_points (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  radius_km REAL NOT NULL DEFAULT 5,
  event_types TEXT   -- NULL = all types, else JSON array e.g. ["slippery","accident"]
);
CREATE INDEX idx_saved_points_user ON saved_points(user_id);

CREATE TABLE hazards (
  external_id TEXT PRIMARY KEY,      -- Tark Tee's own event/situation ID from DATEX II payload
  event_type TEXT NOT NULL,          -- 'slippery' | 'obstacle' | 'accident' | 'roadworks' |
                                      -- 'reduced_visibility' | 'blockage' | 'weather'
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  description TEXT,
  starts_at TEXT,
  ends_at TEXT,                      -- NULL while still active
  raw_json TEXT NOT NULL,            -- full original DATEX II fragment, for debugging/replay
  first_seen_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  notified_at TEXT                   -- set once matching/push has run for this hazard
);
CREATE INDEX idx_hazards_active ON hazards(ends_at);
-- No index on event_type — it's only ever selected, never filtered, by any current query.
-- Every index adds a write cost on any row write that touches its column (confirmed via
-- Cloudflare's own D1 docs), so an unused one is pure overhead. Add back if a "filter by
-- hazard type" query ever gets built.

-- Electronic road sign (VMS) content, from the same ArcGIS service pattern as
-- weather_stations/restrictions/detours (tram/vms_traffic_signs). sign_id is that service's
-- own objectid — confirmed only ~150 of the 180 it claims via count are actually retrievable
-- by query (see ingest-worker/src/arcgis.ts's fetchVmsSigns comment), same discrepancy already
-- seen once with the old broken camera metadata feed. Fully paid-gated (unlike cameras, whose
-- locations are free) — the whole value of this data is the live speed_limit/warning content,
-- there's no meaningful free "just the location" tier for a sign with no other content.
CREATE TABLE vms_signs (
  sign_id INTEGER PRIMARY KEY,
  road_nr INTEGER,
  road_name TEXT,
  road_km REAL,
  angle INTEGER,
  speed_limit INTEGER,
  speed_limit_changed_at TEXT,
  warning TEXT,
  warning_changed_at TEXT,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Sourced from the ArcGIS service behind Tark Tee's own map (tram/road_weather_stations),
-- not the registered DATEX II feeds — those only ever expose batch/quality status, never real
-- sensor readings (confirmed directly). id is that service's own objectid, not the old DATEX
-- station id scheme.
CREATE TABLE weather_stations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  road_status TEXT,              -- 'DRY' | 'MOIST' | 'WET', nullable (sensor-dependent)
  road_status_aggregate TEXT,    -- 'OK' | 'COLD_WET_SURFACE' | 'OVER_2_HOURS' (stale data), etc.
  road_temp REAL,
  air_temp REAL,
  precipitation_type TEXT,
  precipitation_intensity REAL,
  wind_dir INTEGER,
  wind_speed REAL,
  air_humidity REAL,
  visibility INTEGER,
  grip_factor REAL,              -- friction estimate, 0 (slick) to ~1 (dry grip)
  measurement_time TEXT,
  last_updated_at TEXT
);

-- Roadworks/closures/restrictions, also from the ArcGIS service (tram/restrictions_traffic) —
-- a separate, much broader category than the `hazards` table's DATEX SRTI safety situations
-- (routine paving/maintenance vs. accidents/slippery-road alerts). id is that service's
-- objectid. Only currently-active-or-starting-soon rows are ingested (see ingest-worker's
-- arcgis.ts where-clause) — the upstream layer holds a multi-year historical archive we don't
-- want to store in full.
CREATE TABLE restrictions (
  id INTEGER PRIMARY KEY,
  road_nr INTEGER,
  road_name TEXT,
  road_type TEXT,
  cause TEXT,
  effect TEXT,
  extra_info TEXT,
  extra_info_en TEXT,           -- machine-translated cache of extra_info (Workers AI, see
                                 -- ingest-worker's translate.ts) — extra_info only ever comes
                                 -- from Tark Tee in Estonian, no English variant exists upstream
  detour_comment TEXT,
  contractor_organization TEXT,
  contractor_contact_phone TEXT,
  traffic_ctrl_organization TEXT,
  traffic_ctrl_contact_phone TEXT,
  date_from TEXT,
  date_to TEXT,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  notified_at TEXT                -- set once push-matching has run for this restriction,
                                   -- mirroring hazards.notified_at — restrictions participate
                                   -- in saved-point alert matching too (see ingest-worker's
                                   -- push matching in index.ts)
);
-- No index on date_to — despite the name, no query anywhere in this codebase actually filters
-- on it (the active-window filtering happens upstream, in the where-clause sent to ArcGIS, not
-- in our own SQL). Every write to a restriction touches every column in its SET clause
-- including date_to, so this was a real, ongoing write-quota cost with no query benefit —
-- confirmed and dropped.

-- Shared machine-translation cache, reused across any Estonian free-text field (currently
-- restrictions.extra_info; the same mechanism can cover detours.description or hazard
-- descriptions later without a separate cache). Keyed by source_template, not raw source
-- text — digit sequences are normalized to {0},{1},... placeholders first (see
-- ingest-worker's translate.ts normalizeToTemplate), so texts that differ only by an embedded
-- number ("Kiirus piiratud 30 km/h." / "...50 km/h.") share one cached translation instead of
-- each needing its own Workers AI call. Confirmed directly against real restriction text: 19
-- of 265 sampled shared that exact template.
CREATE TABLE translations (
  source_template TEXT PRIMARY KEY,
  translated_template TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Hourly snapshots per station, paid-tier feature. Keyed by station_name rather than
-- weather_stations.id (the upstream ArcGIS objectid) — that id was confirmed unstable across
-- polls (see ingest-worker's db.ts upsertWeatherReadings comment), which would silently break
-- history continuity every time it rotated. site_name was confirmed unique across all 117
-- current stations; using it as the durable identity instead. One row per station per hour —
-- each poll within that hour overwrites it via upsert, so the row reflects the latest reading
-- taken during that hour by the time it rolls over. Pruned after 7 days (see ingest-worker's
-- pruneWeatherHistory) — D1's 5GB storage cap applies regardless of plan, so this can't grow
-- unbounded.
CREATE TABLE weather_station_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  station_name TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  road_status TEXT,
  road_status_aggregate TEXT,
  road_temp REAL,
  air_temp REAL,
  precipitation_type TEXT,
  precipitation_intensity REAL,
  wind_dir INTEGER,
  wind_speed REAL,
  air_humidity REAL,
  visibility INTEGER,
  grip_factor REAL
);
CREATE UNIQUE INDEX idx_weather_history_station_hour ON weather_station_history(station_name, recorded_at);

-- Also from the ArcGIS service (tram/detours) — alternate-route descriptions tied to a
-- specific restriction. No lat/lng: a detour describes the same location as the restriction
-- it's tied to, so api-worker joins this onto the restriction row by restriction_id rather
-- than rendering a second, near-duplicate marker on the map.
CREATE TABLE detours (
  id INTEGER PRIMARY KEY,
  restriction_id INTEGER,
  description TEXT,
  date_from TEXT,
  date_to TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_detours_restriction_id ON detours(restriction_id);

CREATE TABLE cameras (
  id TEXT PRIMARY KEY,           -- UUID, from the roadCameraLocations DATEX II feed —
                                  -- deliberately not the same ID scheme as weather_stations;
                                  -- see tarktee.ts's fetchCamerasMetadata for why
  name TEXT NOT NULL,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  image_url TEXT                 -- live image URL from the DATEX II 3.6 roadCameraLocations
                                  -- feed (same UUID as this row) — paid-tier only, must
                                  -- never appear in the free /api/cameras response
);
