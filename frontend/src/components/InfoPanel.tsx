import { useState } from "preact/hooks";
import { AccountPanel } from "./AccountPanel";

const COFFEE_LINK = "https://buymeacoffee.com/justmaris";

export type Locale = "et" | "en";
type Tab = "info" | "account";

interface InfoPanelProps {
  t: {
    attribution: string;
    info: {
      openButton: string;
      close: string;
      tabInfo: string;
      tabAccount: string;
      aboutLink: string;
      backButton: string;
      aboutTitle: string;
      aboutBody: string;
      aboutBodyExtra: string;
      legendTitle: string;
      legendWeatherStationsTitle: string;
      legendWeatherStationsDesc: string;
      legendCamerasTitle: string;
      legendCamerasDesc: string;
      legendHazardsTitle: string;
      legendHazardsDesc: string;
      legendRestrictionsTitle: string;
      legendRestrictionsDesc: string;
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
      planMonthlyUnit: string;
      planYearly: string;
      planYearlyUnit: string;
      trialTag: string;
      trialNote: string;
      statusActive: string;
      statusLifetime: string;
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
  const [tab, setTab] = useState<Tab>("info");
  const [showAbout, setShowAbout] = useState(false);

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

            {showAbout ? (
              <>
                <button type="button" class="back-link" onClick={() => setShowAbout(false)}>
                  ← {t.info.backButton}
                </button>

                <h2>{t.info.aboutTitle}</h2>
                <p>{t.info.aboutBody}</p>
                <p>{t.info.aboutBodyExtra}</p>

                <h2>{t.info.supportTitle}</h2>
                <p>{t.info.supportBody}</p>
                <a href={COFFEE_LINK} target="_blank" rel="noopener noreferrer">
                  <img
                    class="support-button"
                    src="https://cdn.buymeacoffee.com/buttons/v2/default-blue.png"
                    alt={t.info.supportLink}
                  />
                </a>
              </>
            ) : (
              <>
                <div class="panel-tabs" role="tablist">
                  {(
                    [
                      ["info", t.info.tabInfo],
                      ["account", t.info.tabAccount],
                    ] as const
                  ).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      role="tab"
                      aria-selected={tab === key}
                      class={tab === key ? "panel-tab panel-tab-active" : "panel-tab"}
                      onClick={() => setTab(key)}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {tab === "info" && (
                  <>
                    <h2>{t.info.legendTitle}</h2>
                    <ul class="legend-list">
                      <li class="legend-row">
                        <span class="legend-icon" style={{ background: "#2e9bff" }} />
                        <span class="legend-text">
                          <span class="legend-item-title">{t.info.legendWeatherStationsTitle}</span>
                          <span class="legend-desc">{t.info.legendWeatherStationsDesc}</span>
                        </span>
                      </li>
                      <li class="legend-row">
                        <span class="legend-icon" style={{ background: "#8e44ad" }} />
                        <span class="legend-text">
                          <span class="legend-item-title">{t.info.legendCamerasTitle}</span>
                          <span class="legend-desc">{t.info.legendCamerasDesc}</span>
                        </span>
                      </li>
                      <li class="legend-row">
                        <span class="legend-icon" style={{ background: "#ff3b30" }} />
                        <span class="legend-text">
                          <span class="legend-item-title">{t.info.legendHazardsTitle}</span>
                          <span class="legend-desc">{t.info.legendHazardsDesc}</span>
                        </span>
                      </li>
                      <li class="legend-row">
                        <span class="legend-icon" style={{ background: "#e67e22" }} />
                        <span class="legend-text">
                          <span class="legend-item-title">{t.info.legendRestrictionsTitle}</span>
                          <span class="legend-desc">{t.info.legendRestrictionsDesc}</span>
                        </span>
                      </li>
                    </ul>
                    <p class="legend-note">{t.info.legendClusters}</p>

                    <h2>{t.info.howToTitle}</h2>
                    <ol class="steps-list">
                      <li>{t.info.howTo1}</li>
                      <li>{t.info.howTo2}</li>
                      <li>{t.info.howTo3}</li>
                    </ol>

                    <h2>{t.info.dataTitle}</h2>
                    <p class="data-attribution">{t.attribution}</p>
                  </>
                )}

                {tab === "account" && <AccountPanel t={t} />}

                <button type="button" class="about-link" onClick={() => setShowAbout(true)}>
                  {t.info.aboutLink}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
