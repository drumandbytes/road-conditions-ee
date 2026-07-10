import { useState } from "preact/hooks";
import { AccountPanel } from "./AccountPanel";

const COFFEE_LINK = "https://buymeacoffee.com/justmaris";

export type Locale = "et" | "en";

interface InfoPanelProps {
  t: {
    attribution: string;
    info: {
      openButton: string;
      close: string;
      aboutTitle: string;
      aboutBody: string;
      aboutBodyExtra: string;
      legendTitle: string;
      legendWeatherStations: string;
      legendCameras: string;
      legendHazards: string;
      legendClusters: string;
      howToTitle: string;
      howTo1: string;
      howTo2: string;
      howTo3: string;
      dataTitle: string;
      supportTitle: string;
      supportBody: string;
      supportLink: string;
    };
    account: {
      title: string;
      subscribeBody: string;
      planMonthly: string;
      planYearly: string;
      planLifetime: string;
      trialNote: string;
      activeBody: string;
      lifetimeBody: string;
      manageButton: string;
      error: string;
    };
  };
  locale: Locale;
  onLocaleChange: (locale: Locale) => void;
}

export function InfoPanel({ t, locale, onLocaleChange }: InfoPanelProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" class="info-button" onClick={() => setOpen(true)} aria-label={t.info.openButton}>
        ⓘ
      </button>
      {open && (
        <div class="info-overlay" onClick={() => setOpen(false)}>
          <div class="info-panel" onClick={(e) => e.stopPropagation()}>
            <button type="button" class="info-panel-close" onClick={() => setOpen(false)} aria-label={t.info.close}>
              ×
            </button>

            <div class="locale-toggle" role="group">
              {(["et", "en"] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  class={l === locale ? "locale-button locale-button-active" : "locale-button"}
                  onClick={() => onLocaleChange(l)}
                >
                  {l.toUpperCase()}
                </button>
              ))}
            </div>

            <h2>{t.info.aboutTitle}</h2>
            <p>{t.info.aboutBody}</p>
            <p>{t.info.aboutBodyExtra}</p>

            <AccountPanel t={t} />

            <h2>{t.info.legendTitle}</h2>
            <ul>
              <li>
                <span class="legend-dot" style={{ background: "#0071e3" }} /> {t.info.legendWeatherStations}
              </li>
              <li>
                <span class="legend-dot" style={{ background: "#8e44ad" }} /> {t.info.legendCameras}
              </li>
              <li>
                <span class="legend-dot" style={{ background: "#ff3b30" }} /> {t.info.legendHazards}
              </li>
              <li>{t.info.legendClusters}</li>
            </ul>

            <h2>{t.info.howToTitle}</h2>
            <ul>
              <li>{t.info.howTo1}</li>
              <li>{t.info.howTo2}</li>
              <li>{t.info.howTo3}</li>
            </ul>

            <h2>{t.info.dataTitle}</h2>
            <p>{t.attribution}</p>

            <h2>{t.info.supportTitle}</h2>
            <p>
              {t.info.supportBody}{" "}
              <a href={COFFEE_LINK} target="_blank" rel="noopener noreferrer">
                {t.info.supportLink}
              </a>
              .
            </p>
          </div>
        </div>
      )}
    </>
  );
}
