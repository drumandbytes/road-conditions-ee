import { useEffect, useState } from "preact/hooks";
import { fetchWeatherStationHistory } from "../lib/api";
import type { WeatherHistoryReading } from "../lib/api";
import type { Locale } from "./InfoPanel";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; readings: WeatherHistoryReading[] }
  | { status: "paywalled" }
  | { status: "error" };

// Small duplicates of Map.tsx's label/formatting helpers rather than exporting/sharing them —
// this is the only other place that needs them, and the two components' PopupsT-shaped props
// already overlap structurally (both are handed the same t.popups object from app.tsx).
const ROAD_SURFACE_LABEL_KEY: Record<string, keyof PopupsSubsetT> = {
  DRY: "roadSurfaceDry",
  MOIST: "roadSurfaceMoist",
  WET: "roadSurfaceWet",
};

// Traffic-light scheme distinct from the chart's own air/road line colors, so the surface-dot
// strip under the chart doesn't get confused with the temperature lines above it.
const ROAD_SURFACE_COLOR: Record<string, string> = {
  DRY: "var(--color-success)",
  MOIST: "var(--color-gold)",
  WET: "var(--color-danger)",
};

const PRECIPITATION_LABEL_KEY: Record<string, keyof PopupsSubsetT> = {
  RAIN: "precipRain",
  SNOW: "precipSnow",
  SLEET: "precipSleet",
  HAIL: "precipHail",
  DRIZZLE: "precipDrizzle",
  FREEZING_RAIN: "precipFreezingRain",
};

interface PopupsSubsetT {
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
}

function formatDateTime(iso: string, locale: Locale): string {
  const date = new Date(iso);
  return new Intl.DateTimeFormat(locale === "et" ? "et-EE" : "en-GB", { dateStyle: "short", timeStyle: "short" }).format(
    date,
  );
}

function formatAxisTime(iso: string, locale: Locale): string {
  const date = new Date(iso);
  return new Intl.DateTimeFormat(locale === "et" ? "et-EE" : "en-GB", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatVisibility(meters: number): string {
  return meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${meters} m`;
}

const CHART_WIDTH = 600;
const CHART_HEIGHT = 200;
const CHART_PAD_LEFT = 34;
const CHART_PAD_RIGHT = 8;
const CHART_PAD_TOP = 10;
const CHART_PAD_BOTTOM = 40;
const CHART_DOT_ROW_Y = CHART_HEIGHT - 18;

interface TemperatureChartProps {
  readings: WeatherHistoryReading[];
  locale: Locale;
  airLabel: string;
  roadLabel: string;
}

// Hand-rolled SVG rather than a charting dependency — two lines and a tick axis is well
// within what's worth a library for, and this app has otherwise stayed dependency-light
// (every other icon in Map.tsx is hand-written SVG too).
function TemperatureChart({ readings, locale, airLabel, roadLabel }: TemperatureChartProps) {
  const points = readings
    .filter((r) => r.roadTemp !== null || r.airTemp !== null)
    .slice()
    .sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime());

  if (points.length < 2) return null;

  const times = points.map((p) => new Date(p.recordedAt).getTime());
  const minTime = times[0];
  const maxTime = times[times.length - 1];

  const allTemps = points.flatMap((p) => [p.roadTemp, p.airTemp]).filter((v): v is number => v !== null);
  const minTemp = Math.min(...allTemps);
  const maxTemp = Math.max(...allTemps);
  // Padding so a flat or near-flat line doesn't hug the chart's top/bottom edge.
  const tempPad = Math.max((maxTemp - minTemp) * 0.1, 1);
  const yMin = minTemp - tempPad;
  const yMax = maxTemp + tempPad;

  const plotWidth = CHART_WIDTH - CHART_PAD_LEFT - CHART_PAD_RIGHT;
  const plotHeight = CHART_HEIGHT - CHART_PAD_TOP - CHART_PAD_BOTTOM;

  const xScale = (t: number) => CHART_PAD_LEFT + ((t - minTime) / (maxTime - minTime || 1)) * plotWidth;
  const yScale = (v: number) => CHART_PAD_TOP + (1 - (v - yMin) / (yMax - yMin || 1)) * plotHeight;

  const roadPoints = points
    .filter((p) => p.roadTemp !== null)
    .map((p) => `${xScale(new Date(p.recordedAt).getTime())},${yScale(p.roadTemp!)}`)
    .join(" ");
  const airPoints = points
    .filter((p) => p.airTemp !== null)
    .map((p) => `${xScale(new Date(p.recordedAt).getTime())},${yScale(p.airTemp!)}`)
    .join(" ");

  const yTickCount = 4;
  const yTicks = Array.from({ length: yTickCount + 1 }, (_, i) => yMin + ((yMax - yMin) * i) / yTickCount);

  const xTickCount = Math.min(4, points.length - 1);
  const xTickIndices = Array.from({ length: xTickCount + 1 }, (_, i) =>
    Math.round((i * (points.length - 1)) / xTickCount),
  );

  return (
    <div class="weather-history-chart">
      <div class="weather-history-chart-legend">
        <span class="weather-history-legend-item">
          <span class="weather-history-legend-swatch" style={{ background: "var(--color-accent)" }} />
          {airLabel}
        </span>
        <span class="weather-history-legend-item">
          <span class="weather-history-legend-swatch" style={{ background: "var(--color-gold)" }} />
          {roadLabel}
        </span>
      </div>
      <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} class="weather-history-chart-svg" preserveAspectRatio="none">
        {yTicks.map((v) => (
          <line
            key={v}
            x1={CHART_PAD_LEFT}
            x2={CHART_WIDTH - CHART_PAD_RIGHT}
            y1={yScale(v)}
            y2={yScale(v)}
            class="weather-history-chart-gridline"
          />
        ))}
        {yTicks.map((v) => (
          <text key={v} x={CHART_PAD_LEFT - 6} y={yScale(v)} class="weather-history-chart-axis-label" text-anchor="end">
            {Math.round(v)}°
          </text>
        ))}
        {xTickIndices.map((i) => (
          <text
            key={i}
            x={xScale(times[i])}
            y={CHART_DOT_ROW_Y + 26}
            class="weather-history-chart-axis-label"
            text-anchor="middle"
          >
            {formatAxisTime(points[i].recordedAt, locale)}
          </text>
        ))}
        {/* Road-surface condition per reading, distinct from the two temperature lines above —
            answers "was it actually dry/moist/wet" at a glance without reading the list below. */}
        {points.map((p, i) => {
          const color = ROAD_SURFACE_COLOR[p.roadStatus ?? ""];
          if (!color) return null;
          return <circle key={i} cx={xScale(times[i])} cy={CHART_DOT_ROW_Y} r={2.5} fill={color} />;
        })}
        <polyline points={roadPoints} fill="none" stroke="var(--color-gold)" stroke-width="2" />
        <polyline points={airPoints} fill="none" stroke="var(--color-accent)" stroke-width="2" />
      </svg>
    </div>
  );
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
      <div class="camera-modal weather-history-modal" onClick={(e) => e.stopPropagation()}>
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
          <>
            <TemperatureChart
              readings={state.readings}
              locale={locale}
              airLabel={t.popups.airTemp}
              roadLabel={t.popups.roadTemp}
            />
            <ul class="weather-history-list">
              {state.readings
                .slice()
                .reverse()
                .map((r) => {
                  const surfaceKey = ROAD_SURFACE_LABEL_KEY[r.roadStatus ?? ""];
                  const precipKey = PRECIPITATION_LABEL_KEY[r.precipitationType ?? ""];
                  return (
                    <li key={r.recordedAt} class="weather-history-row">
                      <div class="weather-history-row-time">{formatDateTime(r.recordedAt, locale)}</div>
                      <div class="weather-history-row-fields">
                        {typeof r.roadTemp === "number" && (
                          <span class="weather-history-field">
                            {t.popups.roadTemp}: {r.roadTemp.toFixed(1)}°C
                          </span>
                        )}
                        {typeof r.airTemp === "number" && (
                          <span class="weather-history-field">
                            {t.popups.airTemp}: {r.airTemp.toFixed(1)}°C
                          </span>
                        )}
                        {surfaceKey && <span class="weather-history-field">{t.popups[surfaceKey]}</span>}
                        {typeof r.windSpeed === "number" && (
                          <span class="weather-history-field">
                            {t.popups.wind}: {r.windSpeed.toFixed(1)} m/s
                          </span>
                        )}
                        {typeof r.airHumidity === "number" && (
                          <span class="weather-history-field">
                            {t.popups.humidity}: {Math.round(r.airHumidity)}%
                          </span>
                        )}
                        {typeof r.visibility === "number" && (
                          <span class="weather-history-field">
                            {t.popups.visibility}: {formatVisibility(r.visibility)}
                          </span>
                        )}
                        {precipKey && (
                          <span class="weather-history-field">
                            {t.popups[precipKey]}
                            {typeof r.precipitationIntensity === "number" && r.precipitationIntensity > 0
                              ? ` (${r.precipitationIntensity.toFixed(1)} mm/h)`
                              : ""}
                          </span>
                        )}
                        {typeof r.gripFactor === "number" && (
                          <span class="weather-history-field">
                            {t.popups.grip}: {r.gripFactor.toFixed(2)}
                          </span>
                        )}
                      </div>
                    </li>
                  );
                })}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
