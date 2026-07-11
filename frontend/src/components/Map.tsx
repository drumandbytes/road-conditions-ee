import { useEffect, useRef, useState } from "preact/hooks";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Protocol } from "pmtiles";
import { layers, namedFlavor } from "@protomaps/basemaps";
import { ESTONIA_BOUNDS, MAX_PAN_BOUNDS, ESTONIA_TILES_URL } from "../lib/config";
import { getCameras, getHazards, getWeatherStations } from "../lib/api";
import type { Locale } from "./InfoPanel";

// Registered once at module scope, not per-mount — addProtocol is a global maplibregl
// registration, re-adding it on every component mount/unmount would be redundant.
const protocol = new Protocol();
maplibregl.addProtocol("pmtiles", protocol.tile);

const CLUSTER_LAYER_PAINT = {
  weatherStations: "#2e9bff",
  cameras: "#8e44ad",
  hazards: "#ff3b30",
} as const;

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
  statusGreen: string;
  statusAmber: string;
  statusRed: string;
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

const STATUS_LABEL_KEY: Record<string, keyof PopupsT> = {
  green: "statusGreen",
  amber: "statusAmber",
  red: "statusRed",
};

const STATUS_COLOR: Record<string, string> = {
  green: "var(--color-success)",
  amber: "var(--color-gold)",
  red: "var(--color-danger)",
};

function buildWeatherPopupHtml(properties: Record<string, unknown>, locale: Locale, t: PopupsT): string {
  const name = escapeHtml(String(properties.name ?? ""));
  const status = String(properties.status ?? "");
  const statusLabelKey = STATUS_LABEL_KEY[status];
  const statusLabel = escapeHtml(statusLabelKey ? t[statusLabelKey] : status);
  const statusColor = STATUS_COLOR[status] ?? "var(--color-text-secondary)";
  const updated = formatDateTime(properties.lastUpdatedAt ? String(properties.lastUpdatedAt) : null, locale);

  return `
    <div class="map-popup-title">${name}</div>
    <div class="map-popup-status"><span class="map-popup-status-dot" style="background:${statusColor}"></span>${statusLabel}</div>
    ${updated ? `<div class="map-popup-meta">${escapeHtml(t.lastUpdated)}: ${escapeHtml(updated)}</div>` : ""}
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

interface MarkerLabelsT {
  weatherStations: string;
  cameras: string;
  hazards: string;
}

function addClusteredSource(map: maplibregl.Map, id: keyof typeof CLUSTER_LAYER_PAINT, data: GeoJSON.FeatureCollection) {
  map.addSource(id, { type: "geojson", data, cluster: true, clusterMaxZoom: 14, clusterRadius: 50 });

  map.addLayer({
    id: `${id}-clusters`,
    type: "circle",
    source: id,
    filter: ["has", "point_count"],
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
    layout: { "text-field": "{point_count_abbreviated}", "text-size": 12, "text-font": ["Noto Sans Regular"] },
    paint: { "text-color": "#ffffff" },
  });

  map.addLayer({
    id: `${id}-point`,
    type: "circle",
    source: id,
    filter: ["!", ["has", "point_count"]],
    paint: {
      "circle-color": CLUSTER_LAYER_PAINT[id],
      // Bumped from the original 6px — a legible icon on top needs a bit more room than a
      // plain color dot did.
      "circle-radius": 9,
      "circle-stroke-width": 1.5,
      "circle-stroke-color": "#ffffff",
    },
  });

  map.addLayer({
    id: `${id}-icon`,
    type: "symbol",
    source: id,
    filter: ["!", ["has", "point_count"]],
    layout: { "icon-image": id, "icon-size": 0.58, "icon-allow-overlap": true, "icon-ignore-placement": true },
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

const POINT_LAYER_IDS = (Object.keys(CLUSTER_LAYER_PAINT) as (keyof typeof CLUSTER_LAYER_PAINT)[]).map(
  (key) => `${key}-point`,
);

function openMarkerFeature(
  map: maplibregl.Map,
  feature: maplibregl.MapGeoJSONFeature,
  locale: Locale,
  popupsT: PopupsT,
  onCameraClick: (id: string, name: string) => void,
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
      : buildHazardPopupHtml(properties, locale, popupsT);
  new maplibregl.Popup({ className: "map-popup", maxWidth: "260px" }).setLngLat(coordinates).setHTML(html).addTo(map);
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
  locale: Locale,
  popupsT: PopupsT,
  markerLabelsT: MarkerLabelsT,
  onCameraClick: (id: string, name: string) => void,
) {
  map.on("click", (e) => {
    const features = map.queryRenderedFeatures(e.point, { layers: POINT_LAYER_IDS });
    if (features.length === 0) return;

    if (features.length === 1) {
      openMarkerFeature(map, features[0], locale, popupsT, onCameraClick);
      return;
    }

    const coordinates = (features[0].geometry as GeoJSON.Point).coordinates.slice() as [number, number];
    const popup = new maplibregl.Popup({ className: "map-popup" }).setLngLat(coordinates);
    const content = buildChooserContent(features, markerLabelsT, (chosen) => {
      popup.remove();
      openMarkerFeature(map, chosen, locale, popupsT, onCameraClick);
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
}

export function Map({ flavor, locale, popupsT, markerLabelsT, onCameraClick }: MapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // Gates the loading overlay — without this, a slow or interrupted tile fetch (confirmed:
  // reloading mid-fetch reliably reproduces it) leaves a half-drawn map on screen with no
  // indication it's still loading, which reads as broken rather than "in progress."
  const [tilesReady, setTilesReady] = useState(false);
  const [dataReady, setDataReady] = useState(false);

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
          .then(() => Promise.all([getWeatherStations(), getCameras(), getHazards()]))
          .then(([weatherStations, cameras, hazards]) => {
            addClusteredSource(map!, "weatherStations", weatherStations);
            addClusteredSource(map!, "cameras", cameras);
            addClusteredSource(map!, "hazards", hazards);
            setupPointClickHandling(map!, locale, popupsT, markerLabelsT, onCameraClick);
          })
          .catch((err) => console.error("Failed to load map data layers", err))
          .finally(() => setDataReady(true));
      });
    }

    return () => {
      cancelled = true;
      resizeObserver.disconnect();
      map?.remove();
    };
  // Deliberately excludes onCameraClick — it's a fresh inline closure from app.tsx on every
  // render there, and its own behavior (setSelectedCamera) never actually changes, so
  // depending on it would rebuild the whole map on every unrelated app.tsx re-render.
  }, [flavor, locale, popupsT, markerLabelsT]);

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
