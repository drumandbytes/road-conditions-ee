// Fetch wrapper for api-worker. Bearer token is stored client-side and attached
// automatically to paid-route requests — see app.tsx for where it gets set, right after
// Stripe redirects back from checkout.

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787";
const BEARER_TOKEN_KEY = "road-conditions-bearer-token";

// Components (AccountPanel) that fetched their auth state before this token existed — e.g.
// on initial mount, which races with app.tsx's checkout-completion effect — listen for this
// to know they need to re-fetch, rather than polling or being wired through prop-drilling.
export const BEARER_TOKEN_CHANGED_EVENT = "road-conditions-bearer-token-changed";

export function getBearerToken(): string | null {
  return localStorage.getItem(BEARER_TOKEN_KEY);
}

export function setBearerToken(token: string): void {
  localStorage.setItem(BEARER_TOKEN_KEY, token);
  window.dispatchEvent(new Event(BEARER_TOKEN_CHANGED_EVENT));
}

async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = getBearerToken();
  const headers = new Headers(init?.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(`${API_BASE}${path}`, { ...init, headers });
}

export async function getWeatherStations(): Promise<GeoJSON.FeatureCollection> {
  return (await apiFetch("/api/weather-stations")).json();
}

export async function getCameras(): Promise<GeoJSON.FeatureCollection> {
  return (await apiFetch("/api/cameras")).json();
}

export async function getHazards(): Promise<GeoJSON.FeatureCollection> {
  return (await apiFetch("/api/hazards")).json();
}

export async function getRestrictions(): Promise<GeoJSON.FeatureCollection> {
  return (await apiFetch("/api/restrictions")).json();
}

// Unlike the four free layers above, this 402s for free/unauthenticated users (no
// location-only tier makes sense for live sign content) — returns null rather than throwing,
// so the map can simply omit the layer instead of treating it as a load failure.
export async function getVmsSigns(): Promise<GeoJSON.FeatureCollection | null> {
  const res = await apiFetch("/api/vms");
  if (!res.ok) return null;
  return res.json();
}

export async function fetchCameraImage(cameraId: string): Promise<Response> {
  return apiFetch(`/api/cameras/${cameraId}/image`);
}

export interface WeatherHistoryReading {
  recordedAt: string;
  roadStatus: string | null;
  roadStatusAggregate: string | null;
  roadTemp: number | null;
  airTemp: number | null;
  precipitationType: string | null;
  precipitationIntensity: number | null;
  windDir: number | null;
  windSpeed: number | null;
  airHumidity: number | null;
  visibility: number | null;
  gripFactor: number | null;
}

export async function fetchWeatherStationHistory(stationName: string): Promise<Response> {
  return apiFetch(`/api/weather-stations/${encodeURIComponent(stationName)}/history`);
}

export interface AccountStatus {
  email: string | null;
  subscriptionStatus: string;
}

/** Returns null for both "not authenticated" and "authenticated but not active" — callers
 *  only care about "do we have a working paid session right now," not why not. */
export async function getAccountStatus(): Promise<AccountStatus | null> {
  if (!getBearerToken()) return null;
  const res = await apiFetch("/api/me");
  if (!res.ok) return null;
  return res.json();
}

export type Plan = "monthly" | "yearly";

export async function startCheckout(plan: Plan): Promise<string> {
  const res = await apiFetch("/api/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plan }),
  });
  const body = (await res.json()) as { url?: string; error?: string };
  if (!body.url) throw new Error(body.error ?? "Failed to start checkout");
  return body.url;
}

export async function completeCheckoutSession(sessionId: string): Promise<string> {
  const res = await apiFetch(`/api/checkout/session?session_id=${encodeURIComponent(sessionId)}`);
  const body = (await res.json()) as { bearerToken?: string; error?: string };
  if (!body.bearerToken) throw new Error(body.error ?? "Failed to complete checkout");
  return body.bearerToken;
}

export async function startPortalSession(): Promise<string> {
  const res = await apiFetch("/api/portal", { method: "POST" });
  const body = (await res.json()) as { url?: string; error?: string };
  if (!body.url) throw new Error(body.error ?? "Failed to open billing portal");
  return body.url;
}

export interface GeocodeCandidate {
  label: string;
  lat: number;
  lng: number;
}

/** Free, unauthenticated — see api-worker's geocode route for why this isn't Tark Tee's own
 *  ArcGIS geocoder. Returns [] on any failure (too-short query, upstream error) rather than
 *  throwing — the search box just shows "no results" either way. */
export async function searchAddress(query: string): Promise<GeocodeCandidate[]> {
  const res = await apiFetch(`/api/geocode?q=${encodeURIComponent(query)}`);
  if (!res.ok) return [];
  return res.json();
}

export interface SavedPoint {
  id: number;
  label: string;
  lat: number;
  lng: number;
  radiusKm: number;
  eventTypes: string[] | null;
}

export async function getSavedPoints(): Promise<SavedPoint[]> {
  const res = await apiFetch("/api/subscribe");
  if (!res.ok) return [];
  return res.json();
}

export async function createSavedPoint(params: {
  label: string;
  lat: number;
  lng: number;
  radiusKm: number;
  eventTypes: string[] | null;
}): Promise<SavedPoint> {
  const res = await apiFetch("/api/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const body = (await res.json()) as SavedPoint & { error?: string };
  if (!res.ok) throw new Error(body.error ?? "Failed to save location");
  return body;
}

export async function deleteSavedPoint(id: number): Promise<void> {
  const res = await apiFetch(`/api/subscribe/${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to remove saved location");
}

export interface PushSubscriptionKeys {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export async function registerPushSubscription(subscription: PushSubscriptionKeys): Promise<void> {
  const res = await apiFetch("/api/push-subscription", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(subscription),
  });
  if (!res.ok) throw new Error("Failed to register push subscription");
}
