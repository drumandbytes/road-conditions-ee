import { useEffect, useState } from "preact/hooks";
import { deleteSavedPoint, getSavedPoints } from "../lib/api";
import type { SavedPoint } from "../lib/api";
import { disablePushNotifications, enablePushNotifications, hasActivePushSubscription, pushSupported } from "../lib/push";

type PushStatus = "checking" | "unsupported" | "off" | "on" | "denied" | "error" | "brave-blocked";

export interface SavedPointsSectionT {
  title: string;
  empty: string;
  addButton: string;
  deleteButton: string;
  radiusUnit: string;
  loadError: string;
  pushTitle: string;
  pushEnableButton: string;
  pushEnabling: string;
  pushEnabled: string;
  pushDisableButton: string;
  pushDisabling: string;
  pushDenied: string;
  pushUnsupported: string;
  pushEnableError: string;
  pushEnableErrorBrave: string;
}

interface SavedPointsSectionProps {
  t: SavedPointsSectionT;
  refreshKey: number;
  onAddSavedPoint: () => void;
}

export function SavedPointsSection({ t, refreshKey, onAddSavedPoint }: SavedPointsSectionProps) {
  const [points, setPoints] = useState<SavedPoint[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [pushStatus, setPushStatus] = useState<PushStatus>("checking");
  const [enabling, setEnabling] = useState(false);
  const [disabling, setDisabling] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoadError(false);
    getSavedPoints()
      .then((result) => {
        if (!cancelled) setPoints(result);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  useEffect(() => {
    let cancelled = false;
    if (!pushSupported()) {
      setPushStatus("unsupported");
      return;
    }
    if (Notification.permission === "denied") {
      setPushStatus("denied");
      return;
    }
    hasActivePushSubscription().then((active) => {
      if (!cancelled) setPushStatus(active ? "on" : "off");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function onDelete(id: number) {
    // Optimistic removal — a saved point is low-stakes to lose track of briefly, and this
    // avoids a round-trip flicker for what should feel instant.
    const previous = points;
    setPoints((current) => current?.filter((p) => p.id !== id) ?? null);
    try {
      await deleteSavedPoint(id);
    } catch {
      setPoints(previous ?? null);
    }
  }

  async function onEnablePush() {
    setEnabling(true);
    const result = await enablePushNotifications();
    setEnabling(false);
    setPushStatus(result === "ok" ? "on" : result);
  }

  async function onDisablePush() {
    setDisabling(true);
    const ok = await disablePushNotifications();
    setDisabling(false);
    setPushStatus(ok ? "off" : "on");
  }

  return (
    <>
      <h2>{t.pushTitle}</h2>
      {pushStatus === "unsupported" && <p class="account-trial-note">{t.pushUnsupported}</p>}
      {pushStatus === "denied" && <p class="account-trial-note">{t.pushDenied}</p>}
      {pushStatus === "on" && (
        <>
          <p class="account-trial-note">{t.pushEnabled}</p>
          <button type="button" class="account-button account-button-secondary" onClick={onDisablePush} disabled={disabling}>
            {disabling ? t.pushDisabling : t.pushDisableButton}
          </button>
        </>
      )}
      {pushStatus === "error" && <p class="account-alert account-alert-error">{t.pushEnableError}</p>}
      {pushStatus === "brave-blocked" && (
        <p class="account-alert account-alert-error">{t.pushEnableErrorBrave}</p>
      )}
      {(pushStatus === "off" || pushStatus === "error" || pushStatus === "brave-blocked") && (
        <button type="button" class="account-button" onClick={onEnablePush} disabled={enabling}>
          {enabling ? t.pushEnabling : t.pushEnableButton}
        </button>
      )}

      <h2>{t.title}</h2>
      {loadError && <p class="account-alert account-alert-error">{t.loadError}</p>}
      {points && points.length === 0 && <p class="account-trial-note">{t.empty}</p>}
      {points && points.length > 0 && (
        <ul class="saved-point-list">
          {points.map((point) => (
            <li key={point.id} class="saved-point-row">
              <span class="saved-point-label">
                {point.label}
                <span class="saved-point-radius">
                  {point.radiusKm} {t.radiusUnit}
                </span>
              </span>
              <button
                type="button"
                class="saved-point-delete"
                onClick={() => onDelete(point.id)}
                aria-label={t.deleteButton}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
      <button type="button" class="account-button account-button-secondary" onClick={onAddSavedPoint}>
        {t.addButton}
      </button>
    </>
  );
}
