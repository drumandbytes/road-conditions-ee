import { useEffect, useState } from "preact/hooks";
import { searchAddress } from "../lib/api";
import type { GeocodeCandidate } from "../lib/api";
import type { NearbySearchResult } from "./Map";
import type { LayerId } from "./Map";

export interface SearchT {
  openButton: string;
  placeholder: string;
  searching: string;
  noResults: string;
  nearbyTitle: string;
  noNearby: string;
  close: string;
}

// Same values as Map.tsx's CLUSTER_LAYER_PAINT/InfoPanel.tsx's LEGEND_ROWS — duplicated rather
// than imported for the same reason those two already duplicate each other (see InfoPanel's
// own comment on it): not worth coupling this file to Map.tsx's module just for four colors.
// vms excluded — nearby results never include it, see NearbySearchResult's own comment.
const RESULT_DOT_COLOR: Record<Exclude<LayerId, "vms">, string> = {
  weatherStations: "#2e9bff",
  cameras: "#8e44ad",
  hazards: "#ff3b30",
  restrictions: "#e67e22",
};

// Same debounce/minimum-length rule as SavedPointEditor's address search — both hit the same
// Nominatim-backed endpoint, capped at roughly 1 request/second for the whole app.
const SEARCH_DEBOUNCE_MS = 400;
const MIN_QUERY_LENGTH = 3;

function formatDistanceKm(km: number): string {
  return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
}

interface SearchBarProps {
  t: SearchT;
  nearbyResults: NearbySearchResult[];
  onTargetSelected: (point: { lat: number; lng: number }) => void;
  onClear: () => void;
}

export function SearchBar({ t, nearbyResults, onTargetSelected, onClear }: SearchBarProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<GeocodeCandidate[]>([]);
  const [searching, setSearching] = useState(false);
  // True right after picking an address candidate or a nearby-result row — switches the list
  // below from "address candidates for this query" to "what's nearby", without needing a
  // separate close/reopen. Reset the moment the user types again (see the input's onInput).
  const [pickedLocation, setPickedLocation] = useState(false);

  useEffect(() => {
    if (pickedLocation || query.trim().length < MIN_QUERY_LENGTH) {
      setCandidates([]);
      return;
    }
    setSearching(true);
    const handle = setTimeout(() => {
      searchAddress(query)
        .then(setCandidates)
        .finally(() => setSearching(false));
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [query, pickedLocation]);

  function reset() {
    setOpen(false);
    setQuery("");
    setCandidates([]);
    setPickedLocation(false);
    onClear();
  }

  function pickCandidate(candidate: GeocodeCandidate) {
    setQuery(candidate.label);
    setCandidates([]);
    setPickedLocation(true);
    onTargetSelected({ lat: candidate.lat, lng: candidate.lng });
  }

  function pickNearby(result: NearbySearchResult) {
    onTargetSelected({ lat: result.lat, lng: result.lng });
  }

  if (!open) {
    return (
      <button type="button" class="map-search-button" onClick={() => setOpen(true)} aria-label={t.openButton}>
        🔍
      </button>
    );
  }

  const showCandidates = !pickedLocation && query.trim().length >= MIN_QUERY_LENGTH;
  const showNearby = pickedLocation;

  return (
    <>
      <div class="map-search-bar">
        <input
          type="text"
          class="map-search-input"
          placeholder={t.placeholder}
          value={query}
          autoFocus
          onInput={(e) => {
            setQuery((e.target as HTMLInputElement).value);
            setPickedLocation(false);
          }}
        />
        <button type="button" class="map-search-close" onClick={reset} aria-label={t.close}>
          ×
        </button>
      </div>

      {showCandidates && (
        <div class="map-search-results">
          {searching && <div class="map-search-results-status">{t.searching}</div>}
          {!searching && candidates.length === 0 && <div class="map-search-results-status">{t.noResults}</div>}
          {!searching &&
            candidates.map((candidate, i) => (
              <button key={i} type="button" class="map-search-result-item" onClick={() => pickCandidate(candidate)}>
                {candidate.label}
              </button>
            ))}
        </div>
      )}

      {showNearby && (
        <div class="map-search-results">
          <div class="map-search-results-status">{t.nearbyTitle}</div>
          {nearbyResults.length === 0 && <div class="map-search-results-status">{t.noNearby}</div>}
          {nearbyResults.map((result) => (
            <button
              key={result.id}
              type="button"
              class="map-search-result-item map-search-nearby-item"
              onClick={() => pickNearby(result)}
            >
              <span class="map-search-result-dot" style={{ background: RESULT_DOT_COLOR[result.layerId] }} />
              <span class="map-search-result-label">{result.label}</span>
              <span class="map-search-result-distance">{formatDistanceKm(result.distanceKm)}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
