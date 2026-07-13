import { useState } from "preact/hooks";
import { AccountPanel } from "./AccountPanel";
import type { LayerId } from "./Map";
import type { SavedPointsSectionT } from "./SavedPointsSection";

const COFFEE_LINK = "https://buymeacoffee.com/justmaris";

export type Locale = "et" | "en";
type Tab = "info" | "account";

// Color duplicated from Map.tsx's CLUSTER_LAYER_PAINT rather than imported — this file
// already duplicates the legend's title/desc text lookups the same way, and importing just a
// color constant isn't worth coupling this component to Map.tsx's module (which pulls in
// maplibre-gl) for.
const LEGEND_ROWS: { id: LayerId; color: string; titleKey: keyof InfoPanelProps["t"]["info"]; descKey: keyof InfoPanelProps["t"]["info"] }[] = [
  { id: "weatherStations", color: "#2e9bff", titleKey: "legendWeatherStationsTitle", descKey: "legendWeatherStationsDesc" },
  { id: "cameras", color: "#8e44ad", titleKey: "legendCamerasTitle", descKey: "legendCamerasDesc" },
  { id: "hazards", color: "#ff3b30", titleKey: "legendHazardsTitle", descKey: "legendHazardsDesc" },
  { id: "restrictions", color: "#e67e22", titleKey: "legendRestrictionsTitle", descKey: "legendRestrictionsDesc" },
  { id: "vms", color: "#16a085", titleKey: "legendVmsTitle", descKey: "legendVmsDesc" },
];

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
      legendVmsTitle: string;
      legendVmsDesc: string;
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
    savedPoints: SavedPointsSectionT;
  };
  locale: Locale;
  onLocaleChange: (locale: Locale) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  savedPointsRefreshKey: number;
  onAddSavedPoint: () => void;
}

export function InfoPanel({
  t,
  locale,
  onLocaleChange,
  open,
  onOpenChange,
  savedPointsRefreshKey,
  onAddSavedPoint,
}: InfoPanelProps) {
  const [tab, setTab] = useState<Tab>("info");
  const [showAbout, setShowAbout] = useState(false);

  return (
    <>
      <button type="button" class="info-button" onClick={() => onOpenChange(true)} aria-label={t.info.openButton}>
        ⓘ
      </button>
      {open && (
        <div class="info-overlay" onClick={() => onOpenChange(false)}>
          <div class="info-panel" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              class="info-panel-close"
              onClick={() => onOpenChange(false)}
              aria-label={t.info.close}
            >
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
                      {LEGEND_ROWS.map((row) => (
                        <li key={row.id} class="legend-row">
                          <span class="legend-icon" style={{ background: row.color }} />
                          <span class="legend-text">
                            <span class="legend-item-title">{t.info[row.titleKey]}</span>
                            <span class="legend-desc">{t.info[row.descKey]}</span>
                          </span>
                        </li>
                      ))}
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

                {tab === "account" && (
                  <AccountPanel
                    t={t}
                    savedPointsRefreshKey={savedPointsRefreshKey}
                    onAddSavedPoint={onAddSavedPoint}
                  />
                )}

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
