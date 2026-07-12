// The full set of alert categories a saved point can be scoped to — the union of hazards'
// event_type values and restrictions' effect values (see ingest-worker's notify.ts, which
// matches against exactly these same raw strings). Not enum-validated on the backend
// (api-worker's subscribe route only checks structural shape), so this list is the actual
// source of truth for what a user can pick, kept in sync with the two backend enums by hand
// since there's no shared package between the three deployables in this repo.
export type AlertCategoryGroup = "hazard" | "restriction";

export interface AlertCategory {
  id: string;
  group: AlertCategoryGroup;
  labelKey: string;
  exampleKey: string;
}

export const ALERT_CATEGORIES: AlertCategory[] = [
  { id: "slippery", group: "hazard", labelKey: "categorySlipperyLabel", exampleKey: "categorySlipperyExample" },
  { id: "obstacle", group: "hazard", labelKey: "categoryObstacleLabel", exampleKey: "categoryObstacleExample" },
  { id: "accident", group: "hazard", labelKey: "categoryAccidentLabel", exampleKey: "categoryAccidentExample" },
  { id: "roadworks", group: "hazard", labelKey: "categoryRoadworksLabel", exampleKey: "categoryRoadworksExample" },
  {
    id: "reduced_visibility",
    group: "hazard",
    labelKey: "categoryReducedVisibilityLabel",
    exampleKey: "categoryReducedVisibilityExample",
  },
  { id: "blockage", group: "hazard", labelKey: "categoryBlockageLabel", exampleKey: "categoryBlockageExample" },
  { id: "weather", group: "hazard", labelKey: "categoryWeatherLabel", exampleKey: "categoryWeatherExample" },
  {
    id: "SPEED_LIMITED",
    group: "restriction",
    labelKey: "categorySpeedLimitedLabel",
    exampleKey: "categorySpeedLimitedExample",
  },
  {
    id: "ONE_WAY_CLOSED",
    group: "restriction",
    labelKey: "categoryOneWayClosedLabel",
    exampleKey: "categoryOneWayClosedExample",
  },
  {
    id: "LANE_CLOSED",
    group: "restriction",
    labelKey: "categoryLaneClosedLabel",
    exampleKey: "categoryLaneClosedExample",
  },
  {
    id: "COMPLETE_CLOSURE",
    group: "restriction",
    labelKey: "categoryCompleteClosureLabel",
    exampleKey: "categoryCompleteClosureExample",
  },
  { id: "OTHER", group: "restriction", labelKey: "categoryOtherLabel", exampleKey: "categoryOtherExample" },
];

// Default selection for a new saved point — hazards (safety-relevant, DATEX SRTI situations)
// pre-checked, restrictions (routine roadworks/closures) left for the user to opt into, per
// the user's own decision during planning.
export const DEFAULT_ALERT_CATEGORIES = ALERT_CATEGORIES.filter((c) => c.group === "hazard").map((c) => c.id);

export const DEFAULT_RADIUS_KM = 5;
export const MIN_RADIUS_KM = 1;
export const MAX_RADIUS_KM = 50;
