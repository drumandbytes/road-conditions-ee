import { useEffect, useRef, useState } from "preact/hooks";
import { AccountPanel } from "./AccountPanel";
import type { EmailPreferencesT } from "./EmailPreferencesSection";
import type { FeatureComparisonT } from "./FeatureComparisonTable";
import type { LayerId } from "./Map";
import type { SavedPointsSectionT } from "./SavedPointsSection";
import type { SignInFormT } from "./SignInForm";

const COFFEE_LINK = "https://buymeacoffee.com/justmaris";
const ISSUE_LINK = "https://github.com/drumandbytes/road-conditions-ee/issues/new";

// Drag-resize bounds for the panel handle — a fraction of viewport height with a pixel floor
// (so the header/tabs always stay comfortably visible even on a very short viewport), up to
// nearly the full screen (a small margin keeps the sheet's rounded top corners visible; flush
// to 100% would clip them against the viewport edge).
const MIN_PANEL_HEIGHT_FRACTION = 0.3;
const MIN_PANEL_HEIGHT_FLOOR_PX = 240;
const MAX_PANEL_HEIGHT_MARGIN_PX = 16;
const KEYBOARD_RESIZE_STEP_PX = 40;

function panelHeightBounds(): { min: number; max: number } {
  const viewportHeight = window.innerHeight;
  return {
    min: Math.max(MIN_PANEL_HEIGHT_FLOOR_PX, viewportHeight * MIN_PANEL_HEIGHT_FRACTION),
    max: viewportHeight - MAX_PANEL_HEIGHT_MARGIN_PX,
  };
}

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
      resizeHandle: string;
      tabInfo: string;
      tabAccount: string;
      aboutLink: string;
      backButton: string;
      aboutTitle: string;
      aboutBody: string;
      aboutBodyExtra: string;
      guideLink: string;
      guideUsingMapTitle: string;
      guideUsingMap1: string;
      guideUsingMap2: string;
      guideUsingMap3: string;
      guideUsingMap4: string;
      guideAlertsTitle: string;
      guideAlertsBody1: string;
      guideAlertsBody2: string;
      guideAlertsBody3: string;
      guideAlertsBody4: string;
      guideFreeVsPaidTitle: string;
      guideFreeVsPaidBody: string;
      guideAccountTitle: string;
      guideAccountBody1: string;
      guideAccountBody2: string;
      guideAccountBody3: string;
      guideAccountBody4: string;
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
      issueTitle: string;
      issueBody: string;
      issueLink: string;
      reportIssueLink: string;
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
      adminPanelButton: string;
      error: string;
      signedInAs: string;
      productUpdatesOptInLabel: string;
      deleteAccountButton: string;
      deleteAccountPrompt: string;
      deleteAccountConfirmButton: string;
      deleteAccountCancelButton: string;
      deleteAccountError: string;
    } & FeatureComparisonT;
    savedPoints: SavedPointsSectionT;
    signIn: SignInFormT;
    emailPreferences: EmailPreferencesT;
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
  // Mount AccountPanel on the first visit to the account tab and keep it mounted while the
  // panel stays open — otherwise every info↔account toggle unmounts it and re-fires its
  // /api/me + /api/subscribe + /api/email-preferences fetches. Resets when the panel closes.
  const [accountVisited, setAccountVisited] = useState(false);
  useEffect(() => {
    if (tab === "account") setAccountVisited(true);
  }, [tab]);
  const [subview, setSubview] = useState<"none" | "about" | "guide">("none");
  // null = no drag/keyboard resize has happened yet — panel uses its normal CSS (content-hugging
  // up to 85vh). Once set, this pixel value drives the panel's height directly, overriding that
  // default entirely (see the inline style below for why max-height needs overriding too).
  const [panelHeight, setPanelHeight] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{ pointerY: number; height: number } | null>(null);

  useEffect(() => {
    if (!dragging) return;

    function onPointerMove(e: PointerEvent) {
      if (!dragStartRef.current) return;
      const { min, max } = panelHeightBounds();
      // Panel is bottom-anchored — dragging up (pointer Y decreases) must grow it, hence the
      // subtraction rather than addition.
      const delta = e.clientY - dragStartRef.current.pointerY;
      const next = Math.min(max, Math.max(min, dragStartRef.current.height - delta));
      setPanelHeight(next);
    }
    function onPointerUp() {
      setDragging(false);
      dragStartRef.current = null;
    }

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [dragging]);

  function onHandlePointerDown(e: PointerEvent) {
    e.preventDefault();
    const currentHeight = panelRef.current?.getBoundingClientRect().height ?? panelHeightBounds().min;
    dragStartRef.current = { pointerY: e.clientY, height: currentHeight };
    setDragging(true);
  }

  // Keyboard equivalent of the drag — a pointer-only control would otherwise be entirely
  // unusable without a mouse/touch input.
  function onHandleKeyDown(e: KeyboardEvent) {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
    e.preventDefault();
    const { min, max } = panelHeightBounds();
    const current = panelHeight ?? panelRef.current?.getBoundingClientRect().height ?? min;
    const step = e.key === "ArrowUp" ? KEYBOARD_RESIZE_STEP_PX : -KEYBOARD_RESIZE_STEP_PX;
    setPanelHeight(Math.min(max, Math.max(min, current + step)));
  }

  return (
    <>
      <button type="button" class="info-button" onClick={() => onOpenChange(true)} aria-label={t.info.openButton}>
        ⓘ
      </button>
      {open && (
        <div class="info-overlay" onClick={() => onOpenChange(false)}>
          <div
            ref={panelRef}
            class="info-panel"
            style={
              panelHeight !== null
                ? { height: `${panelHeight}px`, maxHeight: `${panelHeight}px`, transition: dragging ? "none" : undefined }
                : undefined
            }
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              class="info-panel-handle"
              onPointerDown={onHandlePointerDown}
              onKeyDown={onHandleKeyDown}
              aria-label={t.info.resizeHandle}
            >
              <span class="info-panel-handle-bar" />
            </button>
            <div class="info-panel-header">
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

              <a class="report-bug-chip" href={ISSUE_LINK} target="_blank" rel="noopener noreferrer">
                {t.info.reportIssueLink}
              </a>

              <button
                type="button"
                class="info-panel-close"
                onClick={() => onOpenChange(false)}
                aria-label={t.info.close}
              >
                ×
              </button>
            </div>

            <div class="info-panel-body">
              {subview === "about" && (
                <>
                  <button type="button" class="back-link" onClick={() => setSubview("none")}>
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

                  <h2>{t.info.issueTitle}</h2>
                  <p>
                    {t.info.issueBody}{" "}
                    <a href={ISSUE_LINK} target="_blank" rel="noopener noreferrer">
                      {t.info.issueLink}
                    </a>
                  </p>
                </>
              )}

              {subview === "guide" && (
                <>
                  <button type="button" class="back-link" onClick={() => setSubview("none")}>
                    ← {t.info.backButton}
                  </button>

                  <h2>{t.info.guideUsingMapTitle}</h2>
                  <ol class="steps-list">
                    <li>{t.info.guideUsingMap1}</li>
                    <li>{t.info.guideUsingMap2}</li>
                    <li>{t.info.guideUsingMap3}</li>
                    <li>{t.info.guideUsingMap4}</li>
                  </ol>

                  <h2>{t.info.guideAlertsTitle}</h2>
                  <p>{t.info.guideAlertsBody1}</p>
                  <p>{t.info.guideAlertsBody2}</p>
                  <p>{t.info.guideAlertsBody3}</p>
                  <p>{t.info.guideAlertsBody4}</p>

                  <h2>{t.info.guideFreeVsPaidTitle}</h2>
                  <p>{t.info.guideFreeVsPaidBody}</p>

                  <h2>{t.info.guideAccountTitle}</h2>
                  <p>{t.info.guideAccountBody1}</p>
                  <p>{t.info.guideAccountBody2}</p>
                  <p>{t.info.guideAccountBody3}</p>
                  <p>{t.info.guideAccountBody4}</p>
                </>
              )}

              {subview === "none" && (
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

                  {accountVisited && (
                    <div hidden={tab !== "account"}>
                      <AccountPanel
                        t={t}
                        savedPointsRefreshKey={savedPointsRefreshKey}
                        onAddSavedPoint={onAddSavedPoint}
                      />
                    </div>
                  )}

                  <button type="button" class="about-link" onClick={() => setSubview("guide")}>
                    {t.info.guideLink}
                  </button>
                  <button type="button" class="about-link" onClick={() => setSubview("about")}>
                    {t.info.aboutLink}
                  </button>
                </>
              )}
              </div>
          </div>
        </div>
      )}
    </>
  );
}
