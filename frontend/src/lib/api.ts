// Fetch wrapper for api-worker. Bearer token (set after Stripe checkout, Phase 3) is
// stored client-side and attached automatically to paid-route requests — see push.ts for
// where it gets set.

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787";
const BEARER_TOKEN_KEY = "road-conditions-bearer-token";

export function getBearerToken(): string | null {
  return localStorage.getItem(BEARER_TOKEN_KEY);
}

export function setBearerToken(token: string): void {
  localStorage.setItem(BEARER_TOKEN_KEY, token);
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
