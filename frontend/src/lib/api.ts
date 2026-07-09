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

export async function fetchCameraImage(cameraId: string): Promise<Response> {
  return apiFetch(`/api/cameras/${cameraId}/image`);
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

export async function startCheckout(): Promise<string> {
  const res = await apiFetch("/api/checkout", { method: "POST" });
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
