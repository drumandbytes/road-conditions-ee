import { useState } from "preact/hooks";

export interface FeatureComparisonT {
  comparisonToggle: string;
  comparisonHideToggle: string;
  comparisonFreeHeader: string;
  comparisonPaidHeader: string;
  comparisonWeatherReadings: string;
  comparisonHazards: string;
  comparisonRestrictions: string;
  comparisonLocations: string;
  comparisonCameraImages: string;
  comparisonVmsLive: string;
  comparisonHistory: string;
  comparisonAlerts: string;
}

type RowKey = Exclude<
  keyof FeatureComparisonT,
  "comparisonToggle" | "comparisonHideToggle" | "comparisonFreeHeader" | "comparisonPaidHeader"
>;

// free: false rows are exactly the features gated behind a subscription elsewhere in the app
// (cameras.ts/vms.ts's free/paid field split, weather-history's paid-only route, saved
// points requiring a paid user) — kept in sync with those, not an independent feature list.
const ROWS: { labelKey: RowKey; free: boolean }[] = [
  { labelKey: "comparisonWeatherReadings", free: true },
  { labelKey: "comparisonHazards", free: true },
  { labelKey: "comparisonRestrictions", free: true },
  { labelKey: "comparisonLocations", free: true },
  { labelKey: "comparisonCameraImages", free: false },
  { labelKey: "comparisonVmsLive", free: false },
  { labelKey: "comparisonHistory", free: false },
  { labelKey: "comparisonAlerts", free: false },
];

export function FeatureComparisonTable({ t }: { t: FeatureComparisonT }) {
  const [open, setOpen] = useState(false);

  return (
    <div class="feature-comparison">
      <button type="button" class="feature-comparison-toggle" onClick={() => setOpen((v) => !v)}>
        {open ? t.comparisonHideToggle : t.comparisonToggle}
      </button>
      {open && (
        <table class="feature-comparison-table">
          <thead>
            <tr>
              <th scope="col"></th>
              <th scope="col">{t.comparisonFreeHeader}</th>
              <th scope="col">{t.comparisonPaidHeader}</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.labelKey}>
                <th scope="row">{t[row.labelKey]}</th>
                <td class={row.free ? "feature-comparison-yes" : "feature-comparison-no"}>
                  {row.free ? "✓" : "—"}
                </td>
                <td class="feature-comparison-yes">✓</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
