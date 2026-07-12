import { useEffect, useState } from "preact/hooks";
import { fetchWeatherStationHistory } from "../lib/api";
import type { WeatherHistoryReading } from "../lib/api";
import type { Locale } from "./InfoPanel";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; readings: WeatherHistoryReading[] }
  | { status: "paywalled" }
  | { status: "error" };

// Small duplicate of Map.tsx's road-status label maps rather than exporting/sharing them —
// this is the only other place that needs them, and the two components' PopupsT-shaped props
// already overlap structurally (both are handed the same t.popups object from app.tsx).
const ROAD_CONDITION_LABEL_KEY: Record<string, keyof PopupsSubsetT> = {
  OK: "roadConditionOk",
  COLD_WET_SURFACE: "roadConditionColdWetSurface",
  OVER_2_HOURS: "roadConditionStale",
};

const ROAD_SURFACE_LABEL_KEY: Record<string, keyof PopupsSubsetT> = {
  DRY: "roadSurfaceDry",
  MOIST: "roadSurfaceMoist",
  WET: "roadSurfaceWet",
};

interface PopupsSubsetT {
  roadConditionOk: string;
  roadConditionColdWetSurface: string;
  roadConditionStale: string;
  roadSurfaceDry: string;
  roadSurfaceMoist: string;
  roadSurfaceWet: string;
}

function formatDateTime(iso: string, locale: Locale): string {
  const date = new Date(iso);
  return new Intl.DateTimeFormat(locale === "et" ? "et-EE" : "en-GB", { dateStyle: "short", timeStyle: "short" }).format(
    date,
  );
}

function readingSummary(r: WeatherHistoryReading, t: PopupsSubsetT): string {
  const parts: string[] = [];
  if (typeof r.roadTemp === "number") parts.push(`${r.roadTemp.toFixed(1)}°C`);
  const surfaceKey = ROAD_SURFACE_LABEL_KEY[r.roadStatus ?? ""];
  if (surfaceKey) parts.push(t[surfaceKey]);
  if (typeof r.gripFactor === "number") parts.push(`grip ${r.gripFactor.toFixed(2)}`);
  if (parts.length === 0) {
    // No sensor values at all for this hour (e.g. the station was reporting stale data) —
    // fall back to the condition label so the row isn't blank.
    const conditionKey = ROAD_CONDITION_LABEL_KEY[r.roadStatusAggregate ?? ""];
    if (conditionKey) parts.push(t[conditionKey]);
  }
  return parts.join(" · ");
}

interface WeatherHistoryModalProps {
  stationName: string;
  locale: Locale;
  onClose: () => void;
  t: {
    weatherHistoryModal: {
      close: string;
      title: string;
      loading: string;
      paywalled: string;
      error: string;
      empty: string;
    };
    popups: PopupsSubsetT;
  };
}

export function WeatherHistoryModal({ stationName, locale, onClose, t }: WeatherHistoryModalProps) {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    fetchWeatherStationHistory(stationName)
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 402) {
          setState({ status: "paywalled" });
          return;
        }
        if (!res.ok) {
          setState({ status: "error" });
          return;
        }
        const body = (await res.json()) as { readings: WeatherHistoryReading[] };
        setState({ status: "ready", readings: body.readings });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" });
      });
    return () => {
      cancelled = true;
    };
  }, [stationName]);

  return (
    <div class="camera-modal-overlay" onClick={onClose}>
      <div class="camera-modal" onClick={(e) => e.stopPropagation()}>
        <button type="button" class="camera-modal-close" onClick={onClose} aria-label={t.weatherHistoryModal.close}>
          ×
        </button>
        <h2>
          {t.weatherHistoryModal.title}: {stationName}
        </h2>

        {state.status === "loading" && (
          <div class="camera-modal-status">
            <div class="camera-modal-spinner" />
          </div>
        )}

        {state.status === "paywalled" && (
          <div class="camera-modal-status">
            <p class="camera-modal-status-text">{t.weatherHistoryModal.paywalled}</p>
          </div>
        )}

        {state.status === "error" && (
          <div class="camera-modal-status">
            <p class="camera-modal-status-text">{t.weatherHistoryModal.error}</p>
          </div>
        )}

        {state.status === "ready" && state.readings.length === 0 && (
          <div class="camera-modal-status">
            <p class="camera-modal-status-text">{t.weatherHistoryModal.empty}</p>
          </div>
        )}

        {state.status === "ready" && state.readings.length > 0 && (
          <ul class="weather-history-list">
            {state.readings
              .slice()
              .reverse()
              .map((r) => (
                <li key={r.recordedAt} class="weather-history-row">
                  <span class="weather-history-time">{formatDateTime(r.recordedAt, locale)}</span>
                  <span class="weather-history-summary">{readingSummary(r, t.popups)}</span>
                </li>
              ))}
          </ul>
        )}
      </div>
    </div>
  );
}
