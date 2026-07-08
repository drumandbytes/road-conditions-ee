import { useEffect, useState } from "preact/hooks";
import { Map } from "./components/Map";
import { InfoPanel } from "./components/InfoPanel";
import { CameraModal } from "./components/CameraModal";
import type { Locale } from "./components/InfoPanel";
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
