import { useEffect, useRef, useState } from "preact/hooks";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Protocol } from "pmtiles";
import { layers, namedFlavor } from "@protomaps/basemaps";
import { ESTONIA_BOUNDS, ESTONIA_TILES_URL, WORLD_TILES_URL } from "../lib/config";
import { getCameras, getHazards, getWeatherStations } from "../lib/api";

// Registered once at module scope, not per-mount — addProtocol is a global maplibregl
// registration, re-adding it on every component mount/unmount would be redundant.
const protocol = new Protocol();
maplibregl.addProtocol("pmtiles", protocol.tile);

const CLUSTER_LAYER_PAINT = {
  weatherStations: "#0071e3",
  cameras: "#8e44ad",
  hazards: "#ff3b30",
} as const;

function addClusteredSource(
  map: maplibregl.Map,
  id: keyof typeof CLUSTER_LAYER_PAINT,
  data: GeoJSON.FeatureCollection,
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
    const description = Object.entries(feature.properties ?? {})
      .map(([key, value]) => `<strong>${key}</strong>: ${value}`)
      .join("<br>");
    new maplibregl.Popup().setLngLat(coordinates).setHTML(description).addTo(map);
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
  onCameraClick: (id: string, name: string) => void;
}

export function Map({ onCameraClick }: MapProps) {
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
          sprite: "https://protomaps.github.io/basemaps-assets/sprites/v4/light",
          sources: {
            world: { type: "vector", url: `pmtiles://${WORLD_TILES_URL}`, attribution: "© OpenStreetMap contributors" },
            estonia: { type: "vector", url: `pmtiles://${ESTONIA_TILES_URL}`, attribution: "© OpenStreetMap contributors" },
          },
          // world's layers first (bottom/backdrop), estonia's on top (full detail within its
          // bounds) — see Phase 0 notes on why the backdrop layer exists at all.
          //
          // layers() generates fixed layer IDs (e.g. "roads_shields", "pois") regardless of
          // the source name passed in — only the `source` field is parameterized, not `id`.
          // Calling it twice for two sources produces duplicate IDs, which MapLibre rejects
          // outright (confirmed: broke the deployed map with "duplicate layer id" errors for
          // every layer). Fix: suffix one set's IDs to disambiguate.
          layers: [
            ...layers("world", namedFlavor("light"), { lang: "et" }).map((l) => ({ ...l, id: `${l.id}-world` })),
            ...layers("estonia", namedFlavor("light"), { lang: "et" }),
          ],
        },
      });

      // Explicit fitBounds() call (not the constructor's `bounds` option) — kept as the
      // proven-reliable pattern from earlier testing; the ResizeObserver gate above is what
      // actually fixes the race, this doesn't need to change too.
      map.fitBounds(ESTONIA_BOUNDS, { padding: 20, animate: false });

      // Defensive: even with a correctly-sized container at construction, still observed
      // (repeatedly, in testing) a render where only *part* of the canvas gets painted — a
      // gray/blank band for the rest — despite the canvas's width/height attributes, its WebGL
      // drawing buffer size, and its gl.VIEWPORT all being independently verified correct and
      // matching each other. So this isn't a sizing mismatch at the canvas/GL level. Directly
      // confirmed what actually fixes it: any zoom interaction forces MapLibre to fully repaint
      // and the gray band disappears — a single resize() alone wasn't enough. So force several
      // repaints ourselves via triggerRepaint() across a few animation frames, standing in for
      // the interaction a user would otherwise have to make to work around this themselves.
      map.resize();
      for (let i = 0; i < 5; i++) {
        requestAnimationFrame(() => map!.triggerRepaint());
      }

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
            addClusteredSource(map!, "weatherStations", weatherStations);
            addClusteredSource(map!, "cameras", cameras, (properties) => {
              onCameraClick(String(properties.id), String(properties.name));
            });
            addClusteredSource(map!, "hazards", hazards);
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
  }, []);

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
