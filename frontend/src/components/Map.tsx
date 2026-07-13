import { useEffect, useRef, useState } from "preact/hooks";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Protocol } from "pmtiles";
import { layers, namedFlavor } from "@protomaps/basemaps";
import { ESTONIA_BOUNDS, MAX_PAN_BOUNDS, ESTONIA_TILES_URL } from "../lib/config";
import { getCameras, getHazards, getRestrictions, getVmsSigns, getWeatherStations } from "../lib/api";
import type { Locale } from "./InfoPanel";

// Registered once at module scope, not per-mount — addProtocol is a global maplibregl
// registration, re-adding it on every component mount/unmount would be redundant.
const protocol = new Protocol();
maplibregl.addProtocol("pmtiles", protocol.tile);

const CLUSTER_LAYER_PAINT = {
  weatherStations: "#2e9bff",
  cameras: "#8e44ad",
  hazards: "#ff3b30",
  restrictions: "#e67e22",
  vms: "#16a085",
} as const;

export type LayerId = keyof typeof CLUSTER_LAYER_PAINT;
export const LAYER_IDS = Object.keys(CLUSTER_LAYER_PAINT) as LayerId[];

// VMS sign marker styling — three cases, confirmed against production data (150 signs: 122
// have a speed_limit, of which 12 also have a warning; the other 28 have neither):
// - has a speed_limit: rendered as an actual speed-limit-sign face (white circle, red ring,
//   the real number as text) instead of the generic icon+flat-color treatment every other
//   layer uses — the number itself is the useful information, worth showing without a tap.
// - no speed_limit but has a warning (none currently, but the schema allows it): the normal
//   teal + generic signboard glyph, same treatment as any other "something to say" marker.
// - neither: muted grey — nothing to show, still visible (so the marker count on the map
//   matches reality) but visually deprioritized.
const VMS_MUTED_COLOR = "#8a8f94";
const VMS_SIGN_FACE_COLOR = "#ffffff";
const VMS_SIGN_RING_COLOR = "#d32f2f";

// One small white glyph per marker type, layered on top of its colored circle — plain
// same-size dots in three colors read as arbitrary at a glance, especially for anyone who
// hasn't memorized the legend. Camera and hazard icons cut their inner detail (lens, "!")
// out via fill-rule="evenodd" rather than drawing it in a second color, so it shows the
// colored circle through the hole instead of needing a second icon image per theme.
const ICON_SVG: Record<keyof typeof CLUSTER_LAYER_PAINT, string> = {
  weatherStations:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">' +
    '<path fill="#fff" d="M7 17a4.5 4.5 0 0 1-.4-8.98 5.5 5.5 0 0 1 10.6.98A3.5 3.5 0 0 1 17 17H7Z"/></svg>',
  cameras:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">' +
    '<path fill="#fff" fill-rule="evenodd" clip-rule="evenodd" d="M4 8a2 2 0 0 1 2-2h1.2l.9-1.4a1 1 0 0 1 .85-.6h5.1a1 1 0 0 1 .85.6l.9 1.4H18a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8Zm8 2.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6Z"/></svg>',
  hazards:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">' +
    '<path fill="#fff" fill-rule="evenodd" clip-rule="evenodd" d="M12 3.2 22 20H2L12 3.2Zm-1.1 6.3v5.2h2.2V9.5h-2.2Zm0 6.8v2h2.2v-2h-2.2Z"/></svg>',
  // A single diagonal bar — reads as "closed/blocked" without reusing the hazard triangle's
  // shape family, so the two marker types stay visually distinct at a glance.
  restrictions:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">' +
    '<rect fill="#fff" x="2" y="10.5" width="20" height="3" rx="1.5" transform="rotate(-25 12 12)"/></svg>',
  // A signboard with a small pointer tail (like a roadside LED sign on its post) plus three
  // dots suggesting lit segments — distinct from restrictions' plain bar and hazards' triangle.
  vms:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">' +
    '<path fill="#fff" fill-rule="evenodd" clip-rule="evenodd" d="M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-5.1l-1.4 3-1.4-3H6a2 2 0 0 1-2-2V5Zm3.2 4.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2Zm3.8 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2Zm3.8 0a1 1 0 1 0 0 2 1 1 0 0 0 0-2Z"/></svg>',
};

// MapLibre's addImage() needs an actual decoded image, not raw SVG markup — load each icon
// once via a data-URI Image element and register it under a matching id, so layers can
// reference it by icon-image. Resolves to a no-op if already registered (relevant when the
// map rebuilds on theme/locale change, since this runs again each time).
function loadMapImage(map: maplibregl.Map, id: string, svg: string): Promise<void> {
  if (map.hasImage(id)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      if (!map.hasImage(id)) map.addImage(id, img);
      resolve();
    };
    img.onerror = () => reject(new Error(`Failed to load icon image: ${id}`));
    img.src = `data:image/svg+xml;base64,${btoa(svg)}`;
  });
}

interface PopupsT {
  lastUpdated: string;
  until: string;
  ongoing: string;
  hazardSlippery: string;
  hazardObstacle: string;
  hazardAccident: string;
  hazardRoadworks: string;
  hazardReducedVisibility: string;
  hazardBlockage: string;
  hazardWeather: string;
  roadConditionOk: string;
  roadConditionColdWetSurface: string;
  roadConditionStale: string;
  roadSurfaceDry: string;
  roadSurfaceMoist: string;
  roadSurfaceWet: string;
  roadTemp: string;
  airTemp: string;
  wind: string;
  humidity: string;
  visibility: string;
  grip: string;
  precipRain: string;
  precipSnow: string;
  precipSleet: string;
  precipHail: string;
  precipDrizzle: string;
  precipFreezingRain: string;
  viewHistory: string;
  restrictionRoad: string;
  restrictionContractor: string;
  restrictionDetour: string;
  machineTranslated: string;
  restrictionCauseOther: string;
  restrictionCauseConstruction: string;
  restrictionCauseEvent: string;
  restrictionCauseUtilityComsConstruction: string;
  restrictionCausePaving: string;
  restrictionCauseGeologicalStudies: string;
  restrictionCauseCulvertRepairs: string;
  restrictionCauseBarrierWorks: string;
  restrictionCauseRoadSurfaceMarking: string;
  restrictionCauseGravelRoadRepairs: string;
  restrictionCauseSidewalkConstruction: string;
  restrictionCauseStorageOfMaterials: string;
  restrictionEffectSpeedLimited: string;
  restrictionEffectOther: string;
  restrictionEffectOneWayClosed: string;
  restrictionEffectLaneClosed: string;
  restrictionEffectCompleteClosure: string;
  vmsRoad: string;
  vmsSpeedLimit: string;
  vmsWarning: string;
  vmsNoActive: string;
}

// Escapes text pulled from Tark Tee's data (station names, hazard descriptions) before it
// goes into Popup.setHTML() — that API takes raw HTML, so without this any HTML/script
// content in upstream data would execute in the page rather than display as text.
function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function formatDateTime(iso: string | null, locale: Locale): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale === "et" ? "et-EE" : "en-GB", { dateStyle: "medium", timeStyle: "short" }).format(
    date,
  );
}

// road_status_aggregate is the upstream service's own headline classification (see
// ingest-worker/src/arcgis.ts) — used as the popup's colored status line, same visual pattern
// the old green/amber/red status used, just driven by real data instead of feed-health only.
const ROAD_CONDITION_LABEL_KEY: Record<string, keyof PopupsT> = {
  OK: "roadConditionOk",
  COLD_WET_SURFACE: "roadConditionColdWetSurface",
  OVER_2_HOURS: "roadConditionStale",
};

const ROAD_CONDITION_COLOR: Record<string, string> = {
  OK: "var(--color-success)",
  COLD_WET_SURFACE: "var(--color-gold)",
  OVER_2_HOURS: "var(--color-text-secondary)",
};

const ROAD_SURFACE_LABEL_KEY: Record<string, keyof PopupsT> = {
  DRY: "roadSurfaceDry",
  MOIST: "roadSurfaceMoist",
  WET: "roadSurfaceWet",
};

const PRECIPITATION_LABEL_KEY: Record<string, keyof PopupsT> = {
  RAIN: "precipRain",
  SNOW: "precipSnow",
  SLEET: "precipSleet",
  HAIL: "precipHail",
  DRIZZLE: "precipDrizzle",
  FREEZING_RAIN: "precipFreezingRain",
};

function formatVisibility(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${meters} m`;
}

// Shows the station's actual measured values (temp, road surface, wind, grip) rather than
// just a "reporting normally" status dot — see the conversation that led here: a status-only
// popup doesn't tell anyone whether the road is actually fine, and this data (sourced from
// ingest-worker's arcgis.ts) is what makes that answerable.
function buildWeatherPopupHtml(properties: Record<string, unknown>, locale: Locale, t: PopupsT): string {
  const name = escapeHtml(String(properties.name ?? ""));
  const aggregate = String(properties.roadStatusAggregate ?? "");
  const aggregateLabelKey = ROAD_CONDITION_LABEL_KEY[aggregate];
  const aggregateLabel = escapeHtml(aggregateLabelKey ? t[aggregateLabelKey] : aggregate);
  const aggregateColor = ROAD_CONDITION_COLOR[aggregate] ?? "var(--color-text-secondary)";

  const rows: string[] = [];
  if (typeof properties.roadTemp === "number") {
    rows.push(`${escapeHtml(t.roadTemp)}: ${properties.roadTemp.toFixed(1)}°C`);
  }
  if (typeof properties.airTemp === "number") {
    rows.push(`${escapeHtml(t.airTemp)}: ${properties.airTemp.toFixed(1)}°C`);
  }
  const roadSurfaceKey = ROAD_SURFACE_LABEL_KEY[String(properties.roadStatus ?? "")];
  if (roadSurfaceKey) rows.push(escapeHtml(t[roadSurfaceKey]));
  const precipKey = PRECIPITATION_LABEL_KEY[String(properties.precipitationType ?? "")];
  if (precipKey) {
    const intensity = properties.precipitationIntensity;
    const intensitySuffix = typeof intensity === "number" && intensity > 0 ? ` (${intensity.toFixed(1)} mm/h)` : "";
    rows.push(`${escapeHtml(t[precipKey])}${intensitySuffix}`);
  }
  if (typeof properties.windSpeed === "number") {
    rows.push(`${escapeHtml(t.wind)}: ${properties.windSpeed.toFixed(1)} m/s`);
  }
  if (typeof properties.airHumidity === "number") {
    rows.push(`${escapeHtml(t.humidity)}: ${Math.round(properties.airHumidity)}%`);
  }
  if (typeof properties.visibility === "number") {
    rows.push(`${escapeHtml(t.visibility)}: ${formatVisibility(properties.visibility)}`);
  }
  if (typeof properties.gripFactor === "number") {
    rows.push(`${escapeHtml(t.grip)}: ${properties.gripFactor.toFixed(2)}`);
  }

  const updated = formatDateTime(properties.measurementTime ? String(properties.measurementTime) : null, locale);

  return `
    <div class="map-popup-title">${name}</div>
    <div class="map-popup-status"><span class="map-popup-status-dot" style="background:${aggregateColor}"></span>${aggregateLabel}</div>
    ${rows.length > 0 ? `<div class="map-popup-desc">${rows.join("<br>")}</div>` : ""}
    ${updated ? `<div class="map-popup-meta">${escapeHtml(t.lastUpdated)}: ${escapeHtml(updated)}</div>` : ""}
    <button type="button" class="map-popup-history-btn">${escapeHtml(t.viewHistory)}</button>
  `;
}

const HAZARD_LABEL_KEY: Record<string, keyof PopupsT> = {
  slippery: "hazardSlippery",
  obstacle: "hazardObstacle",
  accident: "hazardAccident",
  roadworks: "hazardRoadworks",
  reduced_visibility: "hazardReducedVisibility",
  blockage: "hazardBlockage",
  weather: "hazardWeather",
};

function buildHazardPopupHtml(properties: Record<string, unknown>, locale: Locale, t: PopupsT): string {
  const eventType = String(properties.eventType ?? "");
  const labelKey = HAZARD_LABEL_KEY[eventType];
  const label = escapeHtml(labelKey ? t[labelKey] : eventType);
  const description = properties.description ? escapeHtml(String(properties.description)) : null;
  const startsAt = formatDateTime(properties.startsAt ? String(properties.startsAt) : null, locale);
  const endsAt = formatDateTime(properties.endsAt ? String(properties.endsAt) : null, locale);
  const timeLine = startsAt
    ? `${escapeHtml(startsAt)}${endsAt ? ` – ${escapeHtml(endsAt)}` : ` (${escapeHtml(t.ongoing)})`}`
    : null;

  return `
    <div class="map-popup-title"><span class="map-popup-status-dot" style="background:var(--color-danger)"></span>${label}</div>
    ${description ? `<div class="map-popup-desc">${description}</div>` : ""}
    ${timeLine ? `<div class="map-popup-meta">${timeLine}</div>` : ""}
  `;
}

const RESTRICTION_CAUSE_LABEL_KEY: Record<string, keyof PopupsT> = {
  OTHER: "restrictionCauseOther",
  CONSTRUCTION: "restrictionCauseConstruction",
  EVENT: "restrictionCauseEvent",
  UTILITY_COMS_CONSTRUCTION: "restrictionCauseUtilityComsConstruction",
  PAVING: "restrictionCausePaving",
  GEOLOGICAL_STUDIES: "restrictionCauseGeologicalStudies",
  CULVERT_REPAIRS: "restrictionCauseCulvertRepairs",
  BARRIER_WORKS: "restrictionCauseBarrierWorks",
  ROAD_SURFACE_MARKING: "restrictionCauseRoadSurfaceMarking",
  GRAVEL_ROAD_REPAIRS: "restrictionCauseGravelRoadRepairs",
  SIDEWALK_CONSTRUCTION: "restrictionCauseSidewalkConstruction",
  STORAGE_OF_MATERIALS: "restrictionCauseStorageOfMaterials",
};

const RESTRICTION_EFFECT_LABEL_KEY: Record<string, keyof PopupsT> = {
  SPEED_LIMITED: "restrictionEffectSpeedLimited",
  OTHER: "restrictionEffectOther",
  ONE_WAY_CLOSED: "restrictionEffectOneWayClosed",
  LANE_CLOSED: "restrictionEffectLaneClosed",
  COMPLETE_CLOSURE: "restrictionEffectCompleteClosure",
};

const RESTRICTION_EFFECT_COLOR: Record<string, string> = {
  COMPLETE_CLOSURE: "var(--color-danger)",
  ONE_WAY_CLOSED: "var(--color-gold)",
  LANE_CLOSED: "var(--color-gold)",
  SPEED_LIMITED: "var(--color-gold)",
  OTHER: "var(--color-text-secondary)",
};

function buildRestrictionPopupHtml(properties: Record<string, unknown>, locale: Locale, t: PopupsT): string {
  const roadName = properties.roadName ? escapeHtml(String(properties.roadName)) : escapeHtml(t.restrictionRoad);
  const effect = String(properties.effect ?? "");
  const effectLabelKey = RESTRICTION_EFFECT_LABEL_KEY[effect];
  const effectLabel = escapeHtml(effectLabelKey ? t[effectLabelKey] : effect);
  const effectColor = RESTRICTION_EFFECT_COLOR[effect] ?? "var(--color-text-secondary)";
  const causeLabelKey = RESTRICTION_CAUSE_LABEL_KEY[String(properties.cause ?? "")];
  const causeLabel = causeLabelKey ? escapeHtml(t[causeLabelKey]) : null;
  // extraInfo only ever comes from Tark Tee in Estonian (no upstream English variant exists) —
  // extraInfoEn is a Workers AI machine translation, cached in D1 by ingest-worker. Shown only
  // in English locale, with a disclaimer, falling back to the Estonian original if translation
  // isn't available yet (e.g. a brand-new restriction the next poll hasn't translated yet).
  const showTranslation = locale === "en" && Boolean(properties.extraInfoEn);
  const extraInfo = showTranslation
    ? escapeHtml(String(properties.extraInfoEn))
    : properties.extraInfo
      ? escapeHtml(String(properties.extraInfo))
      : null;
  const dateFrom = formatDateTime(properties.dateFrom ? String(properties.dateFrom) : null, locale);
  const dateTo = formatDateTime(properties.dateTo ? String(properties.dateTo) : null, locale);
  const timeLine = dateFrom
    ? `${escapeHtml(dateFrom)}${dateTo ? ` – ${escapeHtml(dateTo)}` : ` (${escapeHtml(t.ongoing)})`}`
    : null;
  const contractor = properties.contractorOrganization ? escapeHtml(String(properties.contractorOrganization)) : null;
  const detour = properties.detourDescription ? escapeHtml(String(properties.detourDescription)) : null;

  return `
    <div class="map-popup-title"><span class="map-popup-status-dot" style="background:${effectColor}"></span>${roadName}</div>
    <div class="map-popup-status">${effectLabel}${causeLabel ? ` — ${causeLabel}` : ""}</div>
    ${extraInfo ? `<div class="map-popup-desc">${extraInfo}${showTranslation ? `<span class="map-popup-machine-translated">${escapeHtml(t.machineTranslated)}</span>` : ""}</div>` : ""}
    ${timeLine ? `<div class="map-popup-meta">${timeLine}</div>` : ""}
    ${detour ? `<div class="map-popup-meta">${escapeHtml(t.restrictionDetour)}: ${detour}</div>` : ""}
    ${contractor ? `<div class="map-popup-meta">${escapeHtml(t.restrictionContractor)}: ${contractor}</div>` : ""}
  `;
}

// Shows whatever the sign is currently displaying (speed limit and/or warning text) rather
// than just its location — many signs will have neither set at a given moment (nothing active
// to warn about right now), so that's called out explicitly instead of showing an empty popup.
function buildVmsPopupHtml(properties: Record<string, unknown>, locale: Locale, t: PopupsT): string {
  const roadName = properties.roadName ? escapeHtml(String(properties.roadName)) : escapeHtml(t.vmsRoad);
  const roadKm = typeof properties.roadKm === "number" ? ` (km ${properties.roadKm})` : "";

  const rows: string[] = [];
  if (typeof properties.speedLimit === "number") {
    rows.push(`${escapeHtml(t.vmsSpeedLimit)}: ${properties.speedLimit} km/h`);
  }
  if (properties.warning) {
    rows.push(`${escapeHtml(t.vmsWarning)}: ${escapeHtml(String(properties.warning))}`);
  }

  const changedAtIso = properties.warningChangedAt ?? properties.speedLimitChangedAt;
  const changedAt = formatDateTime(changedAtIso ? String(changedAtIso) : null, locale);

  return `
    <div class="map-popup-title">${roadName}${roadKm}</div>
    <div class="map-popup-desc">${rows.length > 0 ? rows.join("<br>") : escapeHtml(t.vmsNoActive)}</div>
    ${changedAt ? `<div class="map-popup-meta">${escapeHtml(t.lastUpdated)}: ${escapeHtml(changedAt)}</div>` : ""}
  `;
}


export interface MarkerLabelsT {
  weatherStations: string;
  cameras: string;
  hazards: string;
  restrictions: string;
  vms: string;
}

type ColorExpr = string | maplibregl.ExpressionSpecification;

interface PointStyleOverrides {
  fillColor?: ColorExpr;
  strokeColor?: ColorExpr;
  strokeWidth?: number;
  radius?: number;
  // icon-image and text-field can both be set per point (data-driven) so a single layer can
  // show *either* an icon *or* text per feature — currently only vms does this, to show the
  // sign's actual speed-limit number instead of a generic glyph when it has one. "" (empty
  // string) for either means "nothing" for that feature, same semantics as MapLibre's own.
  iconImage?: ColorExpr;
  textField?: maplibregl.ExpressionSpecification;
  textColor?: string;
  // Initial visibility at layer-creation time — subsequent toggles are applied live via
  // setLayoutProperty in Map's own separate effect (see visibleLayers below), not by
  // recreating the layer, but a fresh addClusteredSource call (e.g. after a theme/locale
  // rebuild) needs to start in the right state rather than always defaulting to visible.
  visible?: boolean;
}

function addClusteredSource(
  map: maplibregl.Map,
  id: keyof typeof CLUSTER_LAYER_PAINT,
  data: GeoJSON.FeatureCollection,
  overrides: PointStyleOverrides = {},
) {
  const {
    fillColor = CLUSTER_LAYER_PAINT[id],
    strokeColor = "#ffffff",
    strokeWidth = 1.5,
    radius = 9,
    iconImage = id,
    textField,
    textColor = "#111111",
    visible = true,
  } = overrides;
  const visibility = visible ? "visible" : "none";

  map.addSource(id, { type: "geojson", data, cluster: true, clusterMaxZoom: 14, clusterRadius: 50 });

  map.addLayer({
    id: `${id}-clusters`,
    type: "circle",
    source: id,
    filter: ["has", "point_count"],
    layout: { visibility },
    paint: {
      "circle-color": CLUSTER_LAYER_PAINT[id],
      "circle-radius": ["step", ["get", "point_count"], 14, 10, 18, 50, 24],
      "circle-opacity": 0.85,
    },
  });

  map.addLayer({
    id: `${id}-cluster-count`,
    type: "symbol",
    source: id,
    filter: ["has", "point_count"],
    // text-font must be set explicitly — the style spec's default is "Open Sans Regular,
    // Arial Unicode MS Regular", which our glyphs server (Protomaps' font CDN, only serves
    // "Noto Sans ...") 404s on. Confirmed this exact layer as the source: it's the only
    // symbol layer in the whole style without its own text-font (Protomaps' own layers()
    // output sets it correctly on everything else), and the 404s were for digit codepoints
    // matching cluster-count labels. This wasn't just cosmetic — the resulting continuous
    // failed-glyph retry loop meant the map's "idle" event never fired, which is why the
    // loading-overlay logic elsewhere had to rely on the weaker "load" event instead.
    layout: {
      "text-field": "{point_count_abbreviated}",
      "text-size": 12,
      "text-font": ["Noto Sans Regular"],
      visibility,
    },
    paint: { "text-color": "#ffffff" },
  });

  map.addLayer({
    id: `${id}-point`,
    type: "circle",
    source: id,
    filter: ["!", ["has", "point_count"]],
    layout: { visibility },
    paint: {
      "circle-color": fillColor,
      // Bumped from the original 6px — a legible icon on top needs a bit more room than a
      // plain color dot did.
      "circle-radius": radius,
      "circle-stroke-width": strokeWidth,
      "circle-stroke-color": strokeColor,
    },
  });

  map.addLayer({
    id: `${id}-icon`,
    type: "symbol",
    source: id,
    filter: ["!", ["has", "point_count"]],
    layout: {
      "icon-image": iconImage,
      "icon-size": 0.58,
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
      visibility,
      // Only set when a layer actually uses text (currently just vms's speed-limit number) —
      // omitted entirely for everything else, matching the pre-existing generated layer spec
      // byte-for-byte rather than adding an always-empty text-field to every layer.
      ...(textField !== undefined
        ? ({
            "text-field": textField,
            "text-size": 9,
            "text-font": ["Noto Sans Regular"],
            "text-allow-overlap": true,
            "text-ignore-placement": true,
          } as const)
        : {}),
    },
    ...(textField !== undefined ? { paint: { "text-color": textColor } } : {}),
  });

  // Individual-point clicks are handled by one consolidated listener registered after all
  // three sources exist (see setupPointClickHandling below) — a marker's own layer-scoped
  // click here would independently fire alongside another overlapping marker's, which is
  // exactly the "clicking does the wrong thing" problem at co-located sites (a camera and
  // weather station at the same road-side monitoring point, for instance).

  // Clicking a cluster zooms in to the level where it starts splitting into smaller
  // clusters/individual points, centered on the cluster — standard MapLibre pattern using
  // the source's own getClusterExpansionZoom, not a fixed zoom increment.
  map.on("click", `${id}-clusters`, async (e) => {
    const features = map.queryRenderedFeatures(e.point, { layers: [`${id}-clusters`] });
    const feature = features[0];
    if (!feature || feature.geometry.type !== "Point") return;
    const clusterId = feature.properties?.cluster_id;
    const source = map.getSource(id) as maplibregl.GeoJSONSource;
    const zoom = await source.getClusterExpansionZoom(clusterId);
    map.easeTo({ center: feature.geometry.coordinates as [number, number], zoom });
  });

  for (const layerId of [`${id}-point`, `${id}-clusters`]) {
    map.on("mouseenter", layerId, () => {
      map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", layerId, () => {
      map.getCanvas().style.cursor = "";
    });
  }
}

function openMarkerFeature(
  map: maplibregl.Map,
  feature: maplibregl.MapGeoJSONFeature,
  locale: Locale,
  popupsT: PopupsT,
  onCameraClick: (id: string, name: string) => void,
  onViewHistory: (stationName: string) => void,
) {
  const properties = feature.properties ?? {};
  if (feature.source === "cameras") {
    onCameraClick(String(properties.id), String(properties.name));
    return;
  }
  const coordinates = (feature.geometry as GeoJSON.Point).coordinates.slice() as [number, number];
  const html =
    feature.source === "weatherStations"
      ? buildWeatherPopupHtml(properties, locale, popupsT)
      : feature.source === "restrictions"
        ? buildRestrictionPopupHtml(properties, locale, popupsT)
        : feature.source === "vms"
          ? buildVmsPopupHtml(properties, locale, popupsT)
          : buildHazardPopupHtml(properties, locale, popupsT);
  const popup = new maplibregl.Popup({ className: "map-popup", maxWidth: "260px" })
    .setLngLat(coordinates)
    .setHTML(html)
    .addTo(map);

  // The history button only exists in the weather popup's HTML (see buildWeatherPopupHtml) —
  // wired up after the fact via the popup's own DOM element, same as .setHTML() elsewhere in
  // this file, since MapLibre popups don't offer a hook to attach listeners at build time.
  if (feature.source === "weatherStations") {
    const name = String(properties.name ?? "");
    popup.getElement()?.querySelector(".map-popup-history-btn")?.addEventListener("click", () => {
      popup.remove();
      onViewHistory(name);
    });
  }
}

// Builds the small picker shown when a click hits more than one marker at once (e.g. a
// camera and a weather station at the same road-side monitoring site) — real DOM nodes with
// real click listeners via Popup.setDOMContent(), not an HTML string, since each row needs
// its own interactive handler and building that safely out of escaped strings/inline
// attributes would be more fragile than just constructing the elements directly.
function buildChooserContent(
  features: maplibregl.MapGeoJSONFeature[],
  markerLabelsT: MarkerLabelsT,
  onChoose: (feature: maplibregl.MapGeoJSONFeature) => void,
): HTMLElement {
  const container = document.createElement("div");
  container.className = "map-popup-chooser";
  for (const feature of features) {
    const sourceId = feature.source as keyof typeof CLUSTER_LAYER_PAINT;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "map-popup-chooser-item";

    const dot = document.createElement("span");
    dot.className = "map-popup-status-dot";
    dot.style.background = CLUSTER_LAYER_PAINT[sourceId];
    button.appendChild(dot);
    button.appendChild(document.createTextNode(markerLabelsT[sourceId]));

    button.addEventListener("click", () => onChoose(feature));
    container.appendChild(button);
  }
  return container;
}

// Single map-wide click handler for all marker types, registered once after every source
// exists — replaces what used to be one click listener per source's own "-point" layer.
// Those fired independently of each other, so a click landing where two marker types
// overlap would trigger both at once (e.g. open a popup *and* the camera modal
// simultaneously). Querying every point layer at the click location up front means exactly
// one outcome per click: the single marker if there's only one, or a chooser if there's
// more than one, never both.
function setupPointClickHandling(
  map: maplibregl.Map,
  pointLayerIds: string[],
  locale: Locale,
  popupsT: PopupsT,
  markerLabelsT: MarkerLabelsT,
  onCameraClick: (id: string, name: string) => void,
  onViewHistory: (stationName: string) => void,
) {
  map.on("click", (e) => {
    const features = map.queryRenderedFeatures(e.point, { layers: pointLayerIds });
    if (features.length === 0) return;

    if (features.length === 1) {
      openMarkerFeature(map, features[0], locale, popupsT, onCameraClick, onViewHistory);
      return;
    }

    const coordinates = (features[0].geometry as GeoJSON.Point).coordinates.slice() as [number, number];
    const popup = new maplibregl.Popup({ className: "map-popup" }).setLngLat(coordinates);
    const content = buildChooserContent(features, markerLabelsT, (chosen) => {
      popup.remove();
      openMarkerFeature(map, chosen, locale, popupsT, onCameraClick, onViewHistory);
    });
    popup.setDOMContent(content).addTo(map);
  });
}

interface MapProps {
  flavor: "light" | "dark";
  locale: Locale;
  popupsT: PopupsT;
  markerLabelsT: MarkerLabelsT;
  onCameraClick: (id: string, name: string) => void;
  onViewHistory: (stationName: string) => void;
  // Saved-point placement — a draggable pin shown/moved independently of the clustered data
  // layers above, for the "add a saved location" flow (see SavedPointEditor.tsx). null when
  // not in that flow.
  pinDraft: { lat: number; lng: number } | null;
  onPinDragEnd: (lat: number, lng: number) => void;
  visibleLayers: Record<LayerId, boolean>;
}

export function Map({
  flavor,
  locale,
  popupsT,
  markerLabelsT,
  onCameraClick,
  onViewHistory,
  pinDraft,
  onPinDragEnd,
  visibleLayers,
}: MapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Gates the loading overlay — without this, a slow or interrupted tile fetch (confirmed:
  // reloading mid-fetch reliably reproduces it) leaves a half-drawn map on screen with no
  // indication it's still loading, which reads as broken rather than "in progress."
  const [tilesReady, setTilesReady] = useState(false);
  const [dataReady, setDataReady] = useState(false);
  // Read via a ref inside the init effect (see visibleLayers below) rather than added to that
  // effect's own dependency array — a toggle shouldn't rebuild the whole map (refetching every
  // layer's data); it's applied live instead, via the separate effect below this component.
  // The ref just needs to hold the latest value for the *next* rebuild (a theme/locale change)
  // to start from the right state.
  const visibleLayersRef = useRef(visibleLayers);
  visibleLayersRef.current = visibleLayers;
  // Lets the separate pin-marker effect below reach the current map instance, which otherwise
  // only exists as a local variable inside the big init effect. onPinDragEndRef exists so the
  // marker's dragend listener (attached once, when the marker is created) always calls the
  // latest callback rather than the one captured at creation time — app.tsx passes a fresh
  // inline closure on every render, same as onCameraClick/onViewHistory elsewhere in this file.
  const mapRef = useRef<maplibregl.Map | undefined>(undefined);
  const pinMarkerRef = useRef<maplibregl.Marker | undefined>(undefined);
  const onPinDragEndRef = useRef(onPinDragEnd);
  onPinDragEndRef.current = onPinDragEnd;

  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    let map: maplibregl.Map | undefined;
    let cancelled = false;
    // Theme or locale changes rebuild the map from scratch (this effect re-runs, tearing down
    // the old instance in its cleanup below) rather than trying to hot-swap the style/popups
    // in place — simpler and more reliable than patching MapLibre's diffed style update for a
    // source whose layers, paint, and glyph/sprite URLs all change together, and locale needs
    // a full data re-fetch anyway since popup content is built at click time from whatever
    // locale was captured when the source was added. Reset both gates so the loading overlay
    // reappears for the brief rebuild instead of showing stale map state.
    setTilesReady(false);
    setDataReady(false);

    // Don't construct the Map until the container has a real, non-zero size. MapLibre reads
    // the container's size synchronously at construction time, and on a fresh page load that
    // size isn't always settled yet — confirmed this causes fitBounds to compute the wrong
    // zoom/center against a stale size, and separately confirmed that *patching* this after
    // the fact (re-running fitBounds on a later "resize" event) is itself fragile: it can leave
    // the WebGL canvas rendering only part of its own (correctly-sized) area, permanently, not
    // just transiently. Waiting for a real size upfront avoids the race entirely instead of
    // trying to repair it after the fact.
    const resizeObserver = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      if (width === 0 || height === 0) return;
      resizeObserver.disconnect();
      if (cancelled) return;
      initMap();
    });
    resizeObserver.observe(container);

    function initMap() {
      map = new maplibregl.Map({
        container,
        style: {
          version: 8,
          glyphs: "https://protomaps.github.io/basemaps-assets/fonts/{fontstack}/{range}.pbf",
          sprite: `https://protomaps.github.io/basemaps-assets/sprites/v4/${flavor}`,
          sources: {
            estonia: { type: "vector", url: `pmtiles://${ESTONIA_TILES_URL}`, attribution: "© OpenStreetMap contributors" },
          },
          // No separate world backdrop source anymore — it existed only to fill the area
          // outside estonia.pmtiles' bbox (both at low zoom when zoomed out, and near the
          // bbox edge when panning), which was needed because the viewport could reach areas
          // with no estonia coverage at all. `maxBounds` (see config.ts) now makes that
          // structurally impossible: the viewport can never show anything outside
          // estonia.pmtiles' own bbox, at any zoom level, so there's nothing left for a
          // backdrop to fill. Single source, no minzoom floor needed either — see
          // MAX_PAN_BOUNDS' comment for the full history of why this used to need two sources.
          layers: layers("estonia", namedFlavor(flavor), { lang: "et" }),
        },
        maxBounds: MAX_PAN_BOUNDS,
      });
      mapRef.current = map;

      // Explicit fitBounds() call (not the constructor's `bounds` option) — kept as the
      // proven-reliable pattern from earlier testing; the ResizeObserver gate above is what
      // actually fixes the race, this doesn't need to change too.
      map.fitBounds(ESTONIA_BOUNDS, { padding: 20, animate: false });

      map.resize();

      // "idle" (no pending style/tile/glyph work at all) rather than "load" (only covers the
      // very first viewport's tiles) — safe to rely on now that the container is guaranteed to
      // be correctly sized at construction, and now that the cluster-count text-font fix above
      // stops glyph 404s from retrying forever, which previously meant idle never fired at all.
      // Persistent (not "once"): if idle fires once while some tiles are still incomplete for
      // an unrelated reason, a one-shot listener would miss the later, truly-settled idle.
      map.on("idle", () => setTilesReady(true));

      map.addControl(new maplibregl.NavigationControl(), "top-right");
      map.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true } }), "top-right");

      map.on("load", () => {
        // Icons must be registered before any symbol layer references them — MapLibre throws
        // if icon-image points at an unknown id, so this has to resolve before addClusteredSource.
        Promise.all(
          (Object.keys(ICON_SVG) as (keyof typeof ICON_SVG)[]).map((key) => loadMapImage(map!, key, ICON_SVG[key])),
        )
          .then(() => Promise.all([getWeatherStations(), getCameras(), getHazards(), getRestrictions()]))
          .then(([weatherStations, cameras, hazards, restrictions]) => {
            const addedLayerIds: (keyof typeof CLUSTER_LAYER_PAINT)[] = [
              "weatherStations",
              "cameras",
              "hazards",
              "restrictions",
            ];
            addClusteredSource(map!, "weatherStations", weatherStations, {
              visible: visibleLayersRef.current.weatherStations,
            });
            addClusteredSource(map!, "cameras", cameras, { visible: visibleLayersRef.current.cameras });
            addClusteredSource(map!, "hazards", hazards, { visible: visibleLayersRef.current.hazards });
            addClusteredSource(map!, "restrictions", restrictions, {
              visible: visibleLayersRef.current.restrictions,
            });
            // Fetched separately from the four free layers above so its own failure — a 402 for
            // free/unauthenticated users (resolved to null, not thrown, by getVmsSigns), or any
            // other network error (caught here too) — never falls into the shared .catch()
            // below, which would otherwise drop click handling for every other layer just
            // because this one paid layer isn't available.
            return getVmsSigns()
              .catch((err) => {
                console.error("Failed to load VMS layer", err);
                return null;
              })
              .then((vms) => {
                if (vms) {
                  // All signs are shown (not filtered) — see VMS_MUTED_COLOR's comment for the
                  // three-way styling that distinguishes them instead.
                  const hasSpeedLimit: maplibregl.ExpressionSpecification = [
                    "!=",
                    ["get", "speedLimit"],
                    null,
                  ];
                  const hasWarning: maplibregl.ExpressionSpecification = ["!=", ["get", "warning"], null];
                  addClusteredSource(map!, "vms", vms, {
                    fillColor: ["case", hasSpeedLimit, VMS_SIGN_FACE_COLOR, hasWarning, CLUSTER_LAYER_PAINT.vms, VMS_MUTED_COLOR],
                    strokeColor: ["case", hasSpeedLimit, VMS_SIGN_RING_COLOR, "#ffffff"],
                    strokeWidth: 2,
                    radius: 10,
                    visible: visibleLayersRef.current.vms,
                    iconImage: ["case", hasSpeedLimit, "", "vms"],
                    textField: ["case", hasSpeedLimit, ["to-string", ["get", "speedLimit"]], ""],
                  });
                  addedLayerIds.push("vms");
                }
                setupPointClickHandling(
                  map!,
                  addedLayerIds.map((id) => `${id}-point`),
                  locale,
                  popupsT,
                  markerLabelsT,
                  onCameraClick,
                  onViewHistory,
                );
              });
          })
          .catch((err) => console.error("Failed to load map data layers", err))
          .finally(() => setDataReady(true));
      });
    }

    return () => {
      cancelled = true;
      resizeObserver.disconnect();
      pinMarkerRef.current?.remove();
      pinMarkerRef.current = undefined;
      mapRef.current = undefined;
      map?.remove();
    };
  // Deliberately excludes onCameraClick/onViewHistory — both are fresh inline closures from
  // app.tsx on every render there, and their own behavior (setSelectedCamera/setSelectedWeatherHistoryStation)
  // never actually changes, so depending on them would rebuild the whole map on every
  // unrelated app.tsx re-render.
  }, [flavor, locale, popupsT, markerLabelsT]);

  // Separate from the init effect above — a pinDraft change (e.g. selecting a new address
  // search result) shouldn't rebuild the whole map, just move (or create/remove) this one
  // marker. Guards on mapRef.current existing since pinDraft could theoretically change before
  // the map has finished its async ResizeObserver-gated construction.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!pinDraft) {
      pinMarkerRef.current?.remove();
      pinMarkerRef.current = undefined;
      return;
    }

    if (!pinMarkerRef.current) {
      const marker = new maplibregl.Marker({ draggable: true, color: "#16a085" })
        .setLngLat([pinDraft.lng, pinDraft.lat])
        .addTo(map);
      marker.on("dragend", () => {
        const lngLat = marker.getLngLat();
        onPinDragEndRef.current(lngLat.lat, lngLat.lng);
      });
      pinMarkerRef.current = marker;
      map.flyTo({ center: [pinDraft.lng, pinDraft.lat], zoom: Math.max(map.getZoom(), 12) });
      return;
    }

    // Only reposition/fly for an externally-driven change (a search result) — the dragend
    // handler above already fed this exact position back into pinDraft, so re-flying on that
    // echo would fight the user's own drag gesture.
    const current = pinMarkerRef.current.getLngLat();
    if (Math.abs(current.lat - pinDraft.lat) > 1e-9 || Math.abs(current.lng - pinDraft.lng) > 1e-9) {
      pinMarkerRef.current.setLngLat([pinDraft.lng, pinDraft.lat]);
      map.flyTo({ center: [pinDraft.lng, pinDraft.lat], zoom: Math.max(map.getZoom(), 14) });
    }
  }, [pinDraft]);

  // A toggle from the legend applies live to whichever layers already exist — via
  // setLayoutProperty, not by recreating them — so switching a layer off and back on doesn't
  // re-fetch its data or lose cluster state. Layers that don't exist yet (map still loading,
  // or vms for a free/unauthenticated session) are silently skipped via the getLayer check;
  // they'll pick up the right initial visibility from visibleLayersRef when they're created.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    for (const id of LAYER_IDS) {
      const visibility = visibleLayers[id] !== false ? "visible" : "none";
      for (const suffix of ["-clusters", "-cluster-count", "-point", "-icon"]) {
        const layerId = `${id}${suffix}`;
        if (map.getLayer(layerId)) {
          map.setLayoutProperty(layerId, "visibility", visibility);
        }
      }
    }
  }, [visibleLayers]);

  return (
    <div class="map-container">
      <div ref={containerRef} class="map-canvas-container" />
      {!(tilesReady && dataReady) && (
        <div class="map-loading-overlay">
          <div class="map-loading-spinner" />
        </div>
      )}
    </div>
  );
}
