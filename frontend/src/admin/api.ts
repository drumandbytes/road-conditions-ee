// Separate from ../lib/api.ts deliberately — the main app authenticates with a bearer token
// it attaches itself; this page authenticates via Cloudflare Access's own cookie, which the
// browser attaches automatically to api.drumandbytes.ee once the user's signed in through the
// "Teesilm Admin" Access application (confirmed empirically: authenticating for this page's
// own domain also covers the API domain, no second login prompt — see the multi-destination
// Access application covering both roadconditions.drumandbytes.ee/admin* and
// api.drumandbytes.ee/api/admin*). `credentials: "include"` is what makes the browser send
// that cookie cross-origin; see api-worker's cors.ts for the matching
// Access-Control-Allow-Credentials response header.

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787";

async function adminFetch(path: string): Promise<Response> {
  return fetch(`${API_BASE}${path}`, { credentials: "include" });
}

export interface AdminStats {
  usersByStatus: Record<string, number>;
  totalSavedPoints: number;
  totalPushSubscriptions: number;
  activeHazardsByType: Record<string, number>;
  totalRestrictions: number;
  totalCameras: number;
  totalWeatherStations: number;
  totalVmsSigns: number;
}

export async function getAdminStats(): Promise<AdminStats> {
  const res = await adminFetch("/api/admin/stats");
  if (!res.ok) throw new Error(`Failed to load stats (${res.status})`);
  return res.json();
}

export interface AdminUser {
  id: string;
  email: string | null;
  subscriptionStatus: string;
  createdAt: string;
  savedPointCount: number;
}

export interface AdminUsersPage {
  users: AdminUser[];
  page: number;
  pageSize: number;
  total: number;
}

export async function getAdminUsers(page: number): Promise<AdminUsersPage> {
  const res = await adminFetch(`/api/admin/users?page=${page}`);
  if (!res.ok) throw new Error(`Failed to load users (${res.status})`);
  return res.json();
}

export interface AdminDbOverview {
  sizeBytes: number;
  tableRowCounts: Record<string, number>;
}

export async function getAdminDb(): Promise<AdminDbOverview> {
  const res = await adminFetch("/api/admin/db");
  if (!res.ok) throw new Error(`Failed to load db overview (${res.status})`);
  return res.json();
}

// `day` plus one number per hazard type — see api-worker's admin-trends.ts for why this can't
// be a stricter type (a nominal interface can't express "this one key is a string, the rest
// are numbers").
export type HazardCountsByDay = Record<string, string | number>;

export interface AdminTrends {
  hazardsByDay: HazardCountsByDay[];
  cycleHealthByDay: Array<{ day: string; infoCount: number; issueCount: number }>;
  feedErrorsByDay: HazardCountsByDay[];
}

export async function getAdminTrends(): Promise<AdminTrends> {
  const res = await adminFetch("/api/admin/trends");
  if (!res.ok) throw new Error(`Failed to load trends (${res.status})`);
  return res.json();
}
