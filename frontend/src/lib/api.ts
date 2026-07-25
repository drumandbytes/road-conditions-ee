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

// Clears the local token and fires the same event setBearerToken does, so AccountPanel's
// listener re-fetches /api/me and lands back on "signedOut" without needing a page reload —
// used both after a successful account deletion and (in principle) any future sign-out action.
function clearBearerToken(): void {
  localStorage.removeItem(BEARER_TOKEN_KEY);
  window.dispatchEvent(new Event(BEARER_TOKEN_CHANGED_EVENT));
}

async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const token = getBearerToken();
  const headers = new Headers(init?.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  try {
    return await fetch(`${API_BASE}${path}`, { ...init, headers });
  } catch (err) {
    // fetch() itself throws on a network failure (offline, DNS, etc.) — a real, expected case
    // in a PWA. Every caller in this file already handles `!res.ok` (returning null/[] or
    // throwing a clean message), so synthesizing a failed Response here means that existing
    // handling covers network failures too, instead of an unhandled promise rejection.
    console.error(`[api] request failed for ${path}:`, err instanceof Error ? err.message : err);
    return new Response(null, { status: 503, statusText: "Network error" });
  }
}

// Each returns null on a genuine failure (network error, 4xx/5xx) rather than parsing whatever
// body came back as a FeatureCollection — Map.tsx relies on that to tell "this layer failed"
// from "this layer has real data" and skip only the failed one, not blow up trying to render
// an error body's shape as GeoJSON (which previously could throw partway through adding the
// four layers and silently skip whichever ones hadn't been added yet).
export async function getWeatherStations(): Promise<GeoJSON.FeatureCollection | null> {
  const res = await apiFetch("/api/weather-stations");
  if (!res.ok) return null;
  return res.json();
}

export async function getCameras(): Promise<GeoJSON.FeatureCollection | null> {
  const res = await apiFetch("/api/cameras");
  if (!res.ok) return null;
  return res.json();
}

export async function getHazards(): Promise<GeoJSON.FeatureCollection | null> {
  const res = await apiFetch("/api/hazards");
  if (!res.ok) return null;
  return res.json();
}

export async function getRestrictions(): Promise<GeoJSON.FeatureCollection | null> {
  const res = await apiFetch("/api/restrictions");
  if (!res.ok) return null;
  return res.json();
}

// Free/unauthenticated callers still get 200s here — see api-worker's handleVms — just with
// each feature's properties reduced to location + road context (`paid: false`, no
// speedLimit/warning). Still returns null on a genuine failure (network error, 5xx) so the
// map can omit the layer rather than treating it as a hard error.
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

export async function startCheckout(plan: Plan, productUpdatesOptIn: boolean): Promise<string> {
  const res = await apiFetch("/api/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ plan, productUpdatesOptIn }),
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

export interface EmailPreferences {
  productUpdates: boolean;
  serviceAnnouncements: boolean;
  billing: boolean;
}

export async function getEmailPreferences(): Promise<EmailPreferences | null> {
  const res = await apiFetch("/api/email-preferences");
  if (!res.ok) return null;
  return res.json();
}

export async function updateEmailPreferences(patch: Partial<EmailPreferences>): Promise<EmailPreferences> {
  const res = await apiFetch("/api/email-preferences", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw new Error("Failed to update email preferences");
  return res.json();
}

/** Deletes the account and every row tied to it (server-side cascade — see api-worker's
 *  deleteUser). Clears the local bearer token only on success, so a failed request (e.g. the
 *  backend couldn't cancel an active Stripe subscription) leaves the caller still signed in
 *  rather than locally "logged out" of an account that in fact still exists. */
export async function deleteAccount(): Promise<void> {
  const res = await apiFetch("/api/account", { method: "DELETE" });
  if (!res.ok) throw new Error("Failed to delete account");
  clearBearerToken();
}

/** Requests a magic sign-in link for an already-paying account on a *new* device. Always
 *  resolves (never throws on a "no such account" case) — the backend deliberately responds
 *  the same way regardless of whether the email matched anything, see api-worker's
 *  handleRequestLogin, so the frontend has nothing more specific to report either. */
export async function requestLogin(email: string): Promise<void> {
  const res = await apiFetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!res.ok) throw new Error("Failed to request a sign-in link");
}

export async function completeLogin(token: string): Promise<string> {
  const res = await apiFetch(`/api/login/verify?token=${encodeURIComponent(token)}`);
  const body = (await res.json()) as { bearerToken?: string; error?: string };
  if (!body.bearerToken) throw new Error(body.error ?? "Invalid or expired sign-in link");
  return body.bearerToken;
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

export async function unregisterPushSubscription(endpoint: string): Promise<void> {
  const res = await apiFetch("/api/push-subscription", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint }),
  });
  if (!res.ok) throw new Error("Failed to remove push subscription");
}
