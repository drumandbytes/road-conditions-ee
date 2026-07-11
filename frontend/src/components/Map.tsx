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

function addClusteredSource(
  map: maplibregl.Map,
  id: keyof typeof CLUSTER_LAYER_PAINT,
  data: GeoJSON.FeatureCollection,
  locale: Locale,
  popupsT: PopupsT,
  onPointClick?: (properties: Record<string, unknown>) => void,
) {
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
      "circle-radius": 6,
      "circle-stroke-width": 1.5,
      "circle-stroke-color": "#ffffff",
    },
  });

  map.on("click", `${id}-point`, (e) => {
    const feature = e.features?.[0];
    if (!feature || feature.geometry.type !== "Point") return;
    if (onPointClick) {
      onPointClick(feature.properties ?? {});
      return;
    }
    const coordinates = feature.geometry.coordinates.slice() as [number, number];
    const properties = feature.properties ?? {};
    const html =
      id === "weatherStations"
        ? buildWeatherPopupHtml(properties, locale, popupsT)
        : buildHazardPopupHtml(properties, locale, popupsT);
    new maplibregl.Popup({ className: "map-popup", maxWidth: "260px" }).setLngLat(coordinates).setHTML(html).addTo(map);
  });

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

interface MapProps {
  flavor: "light" | "dark";
  locale: Locale;
  popupsT: PopupsT;
  onCameraClick: (id: string, name: string) => void;
}

export function Map({ flavor, locale, popupsT, onCameraClick }: MapProps) {
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
        Promise.all([getWeatherStations(), getCameras(), getHazards()])
          .then(([weatherStations, cameras, hazards]) => {
            addClusteredSource(map!, "weatherStations", weatherStations, locale, popupsT);
            addClusteredSource(map!, "cameras", cameras, locale, popupsT, (properties) => {
              onCameraClick(String(properties.id), String(properties.name));
            });
            addClusteredSource(map!, "hazards", hazards, locale, popupsT);
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
  }, [flavor, locale, popupsT]);

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
