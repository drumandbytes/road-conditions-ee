import { useEffect, useState } from "preact/hooks";
import { Map } from "./components/Map";
import { InfoPanel } from "./components/InfoPanel";
import { CameraModal } from "./components/CameraModal";
import type { Locale } from "./components/InfoPanel";
import { completeCheckoutSession, setBearerToken } from "./lib/api";
import et from "./i18n/et.json";
import en from "./i18n/en.json";

const TRANSLATIONS: Record<Locale, typeof et> = { et, en };
const LOCALE_STORAGE_KEY = "road-conditions-locale";

function getInitialLocale(): Locale {
  const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
  return stored === "en" ? "en" : "et";
}

export function App() {
  const [locale, setLocale] = useState<Locale>(getInitialLocale);
  const [selectedCamera, setSelectedCamera] = useState<{ id: string; name: string } | null>(null);
  const t = TRANSLATIONS[locale];

  useEffect(() => {
    localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  }, [locale]);

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
        <h1>{t.appName}</h1>
      </header>
      <Map onCameraClick={(id, name) => setSelectedCamera({ id, name })} />
      <InfoPanel t={t} locale={locale} onLocaleChange={setLocale} />
      {selectedCamera && (
        <CameraModal
          cameraId={selectedCamera.id}
          cameraName={selectedCamera.name}
          onClose={() => setSelectedCamera(null)}
          t={t}
        />
      )}
    </div>
  );
}
