import { useEffect, useRef } from "preact/hooks";
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
    layout: { "text-field": "{point_count_abbreviated}", "text-size": 12 },
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

export function Map() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
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

    // Explicit fitBounds() instead of the constructor's `bounds` option — the constructor
    // option didn't reliably take effect (confirmed: deployed map showed a default
    // zoomed-out view of Northern Europe/Russia instead of fitting to Estonia).
    map.fitBounds(ESTONIA_BOUNDS, { padding: 20, animate: false });

    map.addControl(new maplibregl.NavigationControl(), "top-right");
    map.addControl(new maplibregl.GeolocateControl({ positionOptions: { enableHighAccuracy: true } }), "top-right");

    map.on("load", () => {
      Promise.all([getWeatherStations(), getCameras(), getHazards()])
        .then(([weatherStations, cameras, hazards]) => {
          addClusteredSource(map, "weatherStations", weatherStations);
          addClusteredSource(map, "cameras", cameras);
          addClusteredSource(map, "hazards", hazards);
        })
        .catch((err) => console.error("Failed to load map data layers", err));
    });

    return () => map.remove();
  }, []);

  return <div ref={containerRef} class="map-container" />;
}
