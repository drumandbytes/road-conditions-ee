import { useEffect, useState } from "preact/hooks";
import { createSavedPoint, searchAddress } from "../lib/api";
import type { GeocodeCandidate } from "../lib/api";
import {
  ALERT_CATEGORIES,
  DEFAULT_ALERT_CATEGORIES,
  DEFAULT_RADIUS_KM,
  MAX_RADIUS_KM,
  MIN_RADIUS_KM,
} from "../lib/alertCategories";

export interface SavedPointsT {
  addTitle: string;
  placingInstructions: string;
  searchPlaceholder: string;
  searching: string;
  noResults: string;
  confirmLocationButton: string;
  backButton: string;
  cancelButton: string;
  saveButton: string;
  saving: string;
  labelFieldLabel: string;
  labelPlaceholder: string;
  radiusLabel: string;
  categoriesTitle: string;
  savingError: string;
  categorySlipperyLabel: string;
  categorySlipperyExample: string;
  categoryObstacleLabel: string;
  categoryObstacleExample: string;
  categoryAccidentLabel: string;
  categoryAccidentExample: string;
  categoryRoadworksLabel: string;
  categoryRoadworksExample: string;
  categoryReducedVisibilityLabel: string;
  categoryReducedVisibilityExample: string;
  categoryBlockageLabel: string;
  categoryBlockageExample: string;
  categoryWeatherLabel: string;
  categoryWeatherExample: string;
  categorySpeedLimitedLabel: string;
  categorySpeedLimitedExample: string;
  categoryOneWayClosedLabel: string;
  categoryOneWayClosedExample: string;
  categoryLaneClosedLabel: string;
  categoryLaneClosedExample: string;
  categoryCompleteClosureLabel: string;
  categoryCompleteClosureExample: string;
  categoryOtherLabel: string;
  categoryOtherExample: string;
}

type CategoryTextKey = Exclude<
  keyof SavedPointsT,
  keyof {
    addTitle: never;
    placingInstructions: never;
    searchPlaceholder: never;
    searching: never;
    noResults: never;
    confirmLocationButton: never;
    backButton: never;
    cancelButton: never;
    saveButton: never;
    saving: never;
    labelFieldLabel: never;
    labelPlaceholder: never;
    radiusLabel: never;
    categoriesTitle: never;
    savingError: never;
  }
>;

interface SavedPointEditorProps {
  t: SavedPointsT;
  pin: { lat: number; lng: number };
  onPinMove: (lat: number, lng: number) => void;
  onClose: () => void;
  onSaved: () => void;
  // Lets Map.tsx draw a live radius-coverage circle around the pin while the slider below is
  // visible — null hides it (not shown during the "placing" step, since the radius hasn't
  // been chosen yet at that point).
  onRadiusPreviewChange: (radiusKm: number | null) => void;
}

// Debounced so every keystroke doesn't fire a request — Nominatim's usage policy caps at
// roughly 1 request/second for this whole app, not just one user's typing.
const SEARCH_DEBOUNCE_MS = 400;

export function SavedPointEditor({
  t,
  pin,
  onPinMove,
  onClose,
  onSaved,
  onRadiusPreviewChange,
}: SavedPointEditorProps) {
  const [step, setStep] = useState<"placing" | "details">("placing");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeocodeCandidate[]>([]);
  const [searching, setSearching] = useState(false);

  const [label, setLabel] = useState("");
  const [radiusKm, setRadiusKm] = useState(DEFAULT_RADIUS_KM);
  const [eventTypes, setEventTypes] = useState<Set<string>>(new Set(DEFAULT_ALERT_CATEGORIES));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (query.trim().length < 3) {
      setResults([]);
      return;
    }
    setSearching(true);
    const handle = setTimeout(() => {
      searchAddress(query)
        .then(setResults)
        .finally(() => setSearching(false));
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [query]);

  function toggleCategory(id: string) {
    setEventTypes((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function onSave(e: Event) {
    e.preventDefault();
    if (!label.trim()) return;
    setSaving(true);
    setError(false);
    try {
      await createSavedPoint({
        label: label.trim(),
        lat: pin.lat,
        lng: pin.lng,
        radiusKm,
        // All categories selected reads the same as "no filter" to the matching logic (see
        // geo.ts's matchingSavedPoints), so send null rather than every id — smaller payload,
        // and correctly future-proof against a category added later that this point should
        // also match without the user having to come back and re-check it.
        eventTypes: eventTypes.size === ALERT_CATEGORIES.length ? null : [...eventTypes],
      });
      onSaved();
    } catch {
      setError(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div class="pin-editor">
      {step === "placing" && (
        <>
          <div class="pin-editor-search-bar">
            <input
              type="text"
              class="pin-editor-search-input"
              placeholder={t.searchPlaceholder}
              value={query}
              onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
            />
            <button type="button" class="pin-editor-close" onClick={onClose} aria-label={t.cancelButton}>
              ×
            </button>
          </div>
          {query.trim().length >= 3 && (
            <div class="pin-editor-results">
              {searching && <div class="pin-editor-results-status">{t.searching}</div>}
              {!searching && results.length === 0 && <div class="pin-editor-results-status">{t.noResults}</div>}
              {!searching &&
                results.map((candidate, i) => (
                  <button
                    key={i}
                    type="button"
                    class="pin-editor-result-item"
                    onClick={() => {
                      onPinMove(candidate.lat, candidate.lng);
                      setResults([]);
                      setQuery("");
                    }}
                  >
                    {candidate.label}
                  </button>
                ))}
            </div>
          )}

          <div class="pin-editor-sheet">
            <p class="pin-editor-instructions">{t.placingInstructions}</p>
            <div class="pin-editor-actions">
              <button type="button" class="account-button account-button-secondary" onClick={onClose}>
                {t.cancelButton}
              </button>
              <button
                type="button"
                class="account-button"
                onClick={() => {
                  setStep("details");
                  onRadiusPreviewChange(radiusKm);
                }}
              >
                {t.confirmLocationButton}
              </button>
            </div>
          </div>
        </>
      )}

      {step === "details" && (
        <form class="pin-editor-sheet" onSubmit={onSave}>
          <h2>{t.addTitle}</h2>

          {error && <p class="account-alert account-alert-error">{t.savingError}</p>}

          <label class="form-field">
            <span class="form-field-label">{t.labelFieldLabel}</span>
            <input
              type="text"
              placeholder={t.labelPlaceholder}
              value={label}
              maxLength={60}
              required
              onInput={(e) => setLabel((e.target as HTMLInputElement).value)}
            />
          </label>

          <label class="form-field">
            <span class="form-field-label">
              {t.radiusLabel}: {radiusKm} km
            </span>
            <input
              type="range"
              min={MIN_RADIUS_KM}
              max={MAX_RADIUS_KM}
              step={1}
              value={radiusKm}
              onInput={(e) => {
                const value = Number((e.target as HTMLInputElement).value);
                setRadiusKm(value);
                onRadiusPreviewChange(value);
              }}
            />
          </label>

          <span class="form-field-label">{t.categoriesTitle}</span>
          <div class="category-checklist">
            {ALERT_CATEGORIES.map((category) => (
              <label key={category.id} class="category-item">
                <input
                  type="checkbox"
                  checked={eventTypes.has(category.id)}
                  onChange={() => toggleCategory(category.id)}
                />
                <span class="category-item-text">
                  <span class="category-item-label">{t[category.labelKey as CategoryTextKey]}</span>
                  <span class="category-item-example">{t[category.exampleKey as CategoryTextKey]}</span>
                </span>
              </label>
            ))}
          </div>

          <div class="pin-editor-actions">
            <button
              type="button"
              class="account-button account-button-secondary"
              onClick={() => {
                setStep("placing");
                onRadiusPreviewChange(null);
              }}
            >
              {t.backButton}
            </button>
            <button type="submit" class="account-button" disabled={saving || !label.trim()}>
              {saving ? t.saving : t.saveButton}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
