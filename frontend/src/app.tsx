import { useEffect, useMemo, useState } from "preact/hooks";
import { Map } from "./components/Map";
import { InfoPanel } from "./components/InfoPanel";
import { CameraModal } from "./components/CameraModal";
import { WeatherHistoryModal } from "./components/WeatherHistoryModal";
import { SavedPointEditor } from "./components/SavedPointEditor";
import { ThemeToggle } from "./components/ThemeToggle";
import type { Locale } from "./components/InfoPanel";
import type { Theme } from "./components/ThemeToggle";
import { completeCheckoutSession, setBearerToken } from "./lib/api";
import et from "./i18n/et.json";
import en from "./i18n/en.json";

// Default starting pin position for the "add a saved location" flow, before the user has
// searched or dragged — Tallinn city center, the single most likely starting point for most
// users of an Estonia-focused app. Just a starting point, not a meaningful default location.
const DEFAULT_PIN = { lat: 59.437, lng: 24.7536 };

const TRANSLATIONS: Record<Locale, typeof et> = { et, en };
const LOCALE_STORAGE_KEY = "road-conditions-locale";
const THEME_STORAGE_KEY = "road-conditions-theme";

function getInitialLocale(): Locale {
  const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
  return stored === "en" ? "en" : "et";
}

function getInitialTheme(): Theme {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  return stored === "light" || stored === "dark" || stored === "auto" ? stored : "auto";
}

export function App() {
  const [locale, setLocale] = useState<Locale>(getInitialLocale);
  const [selectedCamera, setSelectedCamera] = useState<{ id: string; name: string } | null>(null);
  const [selectedWeatherHistoryStation, setSelectedWeatherHistoryStation] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>(getInitialTheme);
  const [infoOpen, setInfoOpen] = useState(false);
  const [pinDraft, setPinDraft] = useState<{ lat: number; lng: number } | null>(null);
  // Bumped after a saved point is created — AccountPanel's saved-points list re-fetches
  // whenever this changes (see SavedPointsSection's effect deps), simpler than threading the
  // new point itself back up through several layers of props.
  const [savedPointsRefreshKey, setSavedPointsRefreshKey] = useState(0);
  const [systemPrefersDark, setSystemPrefersDark] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const t = TRANSLATIONS[locale];
  const effectiveTheme: "light" | "dark" = theme === "auto" ? (systemPrefersDark ? "dark" : "light") : theme;
  // Memoized so the object reference only changes when locale actually does — Map depends on
  // it to know when to rebuild, and a fresh object literal every app.tsx render would trigger
  // that rebuild constantly for no reason.
  const markerLabelsT = useMemo(
    () => ({
      weatherStations: t.info.legendWeatherStationsTitle,
      cameras: t.info.legendCamerasTitle,
      hazards: t.info.legendHazardsTitle,
      restrictions: t.info.legendRestrictionsTitle,
      vms: t.info.legendVmsTitle,
    }),
    [locale],
  );

  useEffect(() => {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  }, [locale]);

  useEffect(() => {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);

  useEffect(() => {
    document.documentElement.dataset.theme = effectiveTheme;
  }, [effectiveTheme]);

  // Only matters while theme is "auto" — tracks live OS-level changes (e.g. the system
  // switching at sunset) so the app follows along without a reload.
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setSystemPrefersDark(e.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  // Registers the static public/service-worker.js — needed for PWA installability (the
  // automatic install-prompt banner wants a registered SW present) and, later, for push
  // notification handling. Runs once on mount; browsers that don't support service workers
  // (or don't expose the API, e.g. non-HTTPS contexts) just skip it silently.
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/service-worker.js").catch((err) => {
        console.error("Service worker registration failed", err);
      });
    }
  }, []);

  // Runs once on mount, not tied to locale — this is Stripe redirecting back after checkout,
  // not a locale-dependent concern. Clears the query params afterward either way (success or
  // cancelled) so a page refresh doesn't re-trigger the completion call with a now-stale
  // session_id.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const checkout = params.get("checkout");
    if (checkout !== "success" && checkout !== "cancelled") return;

    const sessionId = params.get("session_id");
    const cleanUp = () => window.history.replaceState({}, "", window.location.pathname);

    if (checkout === "success" && sessionId) {
      completeCheckoutSession(sessionId)
        .then((token) => setBearerToken(token))
        .catch((err) => console.error("Failed to complete checkout", err))
        .finally(cleanUp);
    } else {
      cleanUp();
    }
  }, []);

  return (
    <div class="app">
      <header class="app-header">
        <img src="/favicon.svg" alt="" class="app-logo" />
        <h1>{t.appName}</h1>
        <ThemeToggle theme={theme} onChange={setTheme} labels={t.theme} />
      </header>
      <Map
        flavor={effectiveTheme}
        locale={locale}
        popupsT={t.popups}
        markerLabelsT={markerLabelsT}
        onCameraClick={(id, name) => setSelectedCamera({ id, name })}
        onViewHistory={(stationName) => setSelectedWeatherHistoryStation(stationName)}
        pinDraft={pinDraft}
        onPinDragEnd={(lat, lng) => setPinDraft({ lat, lng })}
      />
      <InfoPanel
        t={t}
        locale={locale}
        onLocaleChange={setLocale}
        open={infoOpen}
        onOpenChange={setInfoOpen}
        savedPointsRefreshKey={savedPointsRefreshKey}
        onAddSavedPoint={() => {
          setInfoOpen(false);
          setPinDraft(DEFAULT_PIN);
        }}
      />
      {pinDraft && (
        <SavedPointEditor
          t={t.savedPoints}
          pin={pinDraft}
          onPinMove={(lat, lng) => setPinDraft({ lat, lng })}
          onClose={() => setPinDraft(null)}
          onSaved={() => {
            setPinDraft(null);
            setSavedPointsRefreshKey((k) => k + 1);
            setInfoOpen(true);
          }}
        />
      )}
      {selectedCamera && (
        <CameraModal
          cameraId={selectedCamera.id}
          cameraName={selectedCamera.name}
          onClose={() => setSelectedCamera(null)}
          t={t}
        />
      )}
      {selectedWeatherHistoryStation && (
        <WeatherHistoryModal
          stationName={selectedWeatherHistoryStation}
          locale={locale}
          onClose={() => setSelectedWeatherHistoryStation(null)}
          t={t}
        />
      )}
    </div>
  );
}
