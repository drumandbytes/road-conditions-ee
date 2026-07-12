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
CREATE INDEX idx_hazards_type ON hazards(event_type);

CREATE TABLE vms_signs (
  sign_id TEXT PRIMARY KEY,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  current_text TEXT,
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
  detour_comment TEXT,
  contractor_organization TEXT,
  contractor_contact_phone TEXT,
  traffic_ctrl_organization TEXT,
  traffic_ctrl_contact_phone TEXT,
  date_from TEXT,
  date_to TEXT,
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_restrictions_date_to ON restrictions(date_to);

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
