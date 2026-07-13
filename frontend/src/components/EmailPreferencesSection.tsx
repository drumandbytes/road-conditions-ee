import { useEffect, useState } from "preact/hooks";
import { getEmailPreferences, updateEmailPreferences } from "../lib/api";
import type { EmailPreferences } from "../lib/api";

export interface EmailPreferencesT {
  title: string;
  productUpdatesLabel: string;
  serviceAnnouncementsLabel: string;
  billingLabel: string;
  loadError: string;
  saveError: string;
}

const CATEGORY_LABEL_KEYS = {
  productUpdates: "productUpdatesLabel",
  serviceAnnouncements: "serviceAnnouncementsLabel",
  billing: "billingLabel",
} as const satisfies Record<keyof EmailPreferences, keyof EmailPreferencesT>;

export function EmailPreferencesSection({ t }: { t: EmailPreferencesT }) {
  const [prefs, setPrefs] = useState<EmailPreferences | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [saveError, setSaveError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getEmailPreferences().then((result) => {
      if (cancelled) return;
      if (result) setPrefs(result);
      else setLoadError(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function onToggle(key: keyof EmailPreferences) {
    if (!prefs) return;
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next); // optimistic — a preference toggle is low-stakes to revert on failure
    setSaveError(false);
    try {
      const saved = await updateEmailPreferences({ [key]: next[key] });
      setPrefs(saved);
    } catch {
      setPrefs(prefs); // revert
      setSaveError(true);
    }
  }

  return (
    <>
      <h2>{t.title}</h2>
      {loadError && <p class="account-alert account-alert-error">{t.loadError}</p>}
      {saveError && <p class="account-alert account-alert-error">{t.saveError}</p>}
      {prefs && (
        <div class="category-checklist">
          {(Object.keys(CATEGORY_LABEL_KEYS) as (keyof EmailPreferences)[]).map((key) => (
            <label key={key} class="category-item">
              <input type="checkbox" checked={prefs[key]} onChange={() => onToggle(key)} />
              <span class="category-item-text">
                <span class="category-item-label">{t[CATEGORY_LABEL_KEYS[key]]}</span>
              </span>
            </label>
          ))}
        </div>
      )}
    </>
  );
}
