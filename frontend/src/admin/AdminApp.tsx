import { useEffect, useState } from "preact/hooks";
import { getAdminDb, getAdminStats, getAdminUsers } from "./api";
import type { AdminDbOverview, AdminStats, AdminUser } from "./api";

const STATUS_LABELS: Record<string, string> = {
  free: "Free",
  active: "Active",
  canceled: "Canceled",
  lifetime: "Lifetime",
};

// Mirrors index.css's .status-badge-{status} classes (shared with AccountPanel) so a
// subscription status always reads as the same color everywhere in the app.
const STATUS_BADGE_CLASS: Record<string, string> = {
  free: "status-badge-free",
  active: "status-badge-active",
  canceled: "status-badge-canceled",
  lifetime: "status-badge-lifetime",
};

// admin.css's .admin-stat-card--{variant} accent colors, keyed the same as STATUS_BADGE_CLASS.
const STATUS_CARD_VARIANT: Record<string, string> = {
  free: "neutral",
  active: "success",
  canceled: "danger",
  lifetime: "gold",
};

const HAZARD_TYPE_LABELS: Record<string, string> = {
  slippery: "Slippery road",
  obstacle: "Obstacle",
  accident: "Accident",
  roadworks: "Roadworks",
  reduced_visibility: "Reduced visibility",
  blockage: "Blockage",
  weather: "Severe weather",
};

const TABLE_LABELS: Record<string, string> = {
  users: "Users",
  login_tokens: "Login tokens",
  email_preferences: "Email preferences",
  push_subscriptions: "Push subscriptions",
  saved_points: "Saved points",
  hazards: "Hazards",
  vms_signs: "VMS signs",
  weather_stations: "Weather stations",
  restrictions: "Restrictions",
  translations: "Translations",
  weather_station_history: "Weather station history",
  detours: "Detours",
  cameras: "Cameras",
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { year: "numeric", month: "short", day: "numeric" });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = -1;
  do {
    value /= 1024;
    unitIndex++;
  } while (value >= 1024 && unitIndex < units.length - 1);
  return `${value.toFixed(value < 10 ? 2 : 1)} ${units[unitIndex]}`;
}

export function AdminApp() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [statsError, setStatsError] = useState(false);
  const [db, setDb] = useState<AdminDbOverview | null>(null);
  const [dbError, setDbError] = useState(false);
  const [users, setUsers] = useState<AdminUser[] | null>(null);
  const [usersError, setUsersError] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(50);

  useEffect(() => {
    getAdminStats()
      .then(setStats)
      .catch(() => setStatsError(true));
  }, []);

  useEffect(() => {
    getAdminDb()
      .then(setDb)
      .catch(() => setDbError(true));
  }, []);

  useEffect(() => {
    setUsers(null);
    setUsersError(false);
    getAdminUsers(page)
      .then((result) => {
        setUsers(result.users);
        setTotal(result.total);
        setPageSize(result.pageSize);
      })
      .catch(() => setUsersError(true));
  }, [page]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const activeHazardsTotal = stats ? Object.values(stats.activeHazardsByType).reduce((sum, n) => sum + n, 0) : 0;
  const totalUsers = stats ? Object.values(stats.usersByStatus).reduce((sum, n) => sum + n, 0) : 0;
  const sortedTables = db ? Object.entries(db.tableRowCounts).sort(([, a], [, b]) => b - a) : [];

  return (
    <div class="admin-app">
      <h1>Teesilm Admin</h1>

      <section>
        <h2>Overview</h2>
        {statsError && <p class="admin-error">Failed to load stats.</p>}
        {!statsError && !stats && <p class="admin-muted">Loading…</p>}
        {stats && (
          <div class="admin-stat-grid">
            <div class="admin-stat-card">
              <span class="admin-stat-value">{totalUsers}</span>
              <span class="admin-stat-label">Total users</span>
            </div>
            {(["free", "active", "canceled", "lifetime"] as const).map((status) => (
              <div class={`admin-stat-card admin-stat-card--${STATUS_CARD_VARIANT[status]}`} key={status}>
                <span class="admin-stat-value">{stats.usersByStatus[status] ?? 0}</span>
                <span class="admin-stat-label">{STATUS_LABELS[status]}</span>
              </div>
            ))}
            <div class="admin-stat-card admin-stat-card--accent">
              <span class="admin-stat-value">{stats.totalSavedPoints}</span>
              <span class="admin-stat-label">Saved locations</span>
            </div>
            <div class="admin-stat-card admin-stat-card--accent">
              <span class="admin-stat-value">{stats.totalPushSubscriptions}</span>
              <span class="admin-stat-label">Push subscriptions</span>
            </div>
          </div>
        )}
      </section>

      <section>
        <h2>Live data</h2>
        {stats && (
          <>
            <div class="admin-stat-grid">
              <div class="admin-stat-card admin-stat-card--danger">
                <span class="admin-stat-value">{activeHazardsTotal}</span>
                <span class="admin-stat-label">Active hazards</span>
              </div>
              <div class="admin-stat-card admin-stat-card--gold">
                <span class="admin-stat-value">{stats.totalRestrictions}</span>
                <span class="admin-stat-label">Roadworks & restrictions</span>
              </div>
              <div class="admin-stat-card admin-stat-card--accent">
                <span class="admin-stat-value">{stats.totalCameras}</span>
                <span class="admin-stat-label">Cameras</span>
              </div>
              <div class="admin-stat-card admin-stat-card--accent">
                <span class="admin-stat-value">{stats.totalWeatherStations}</span>
                <span class="admin-stat-label">Weather stations</span>
              </div>
              <div class="admin-stat-card admin-stat-card--accent">
                <span class="admin-stat-value">{stats.totalVmsSigns}</span>
                <span class="admin-stat-label">VMS signs</span>
              </div>
            </div>
            {Object.keys(stats.activeHazardsByType).length > 0 && (
              <ul class="admin-hazard-breakdown">
                {Object.entries(stats.activeHazardsByType).map(([type, count]) => (
                  <li key={type}>
                    {HAZARD_TYPE_LABELS[type] ?? type}: <strong>{count}</strong>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      <section>
        <h2>Database</h2>
        {dbError && <p class="admin-error">Failed to load database overview.</p>}
        {!dbError && !db && <p class="admin-muted">Loading…</p>}
        {db && (
          <>
            <div class="admin-stat-grid">
              <div class="admin-stat-card admin-stat-card--accent">
                <span class="admin-stat-value">{formatBytes(db.sizeBytes)}</span>
                <span class="admin-stat-label">Database size</span>
              </div>
            </div>
            <ul class="admin-table-rowcounts">
              {sortedTables.map(([table, count]) => (
                <li key={table}>
                  <span class="admin-table-rowcounts-name">{TABLE_LABELS[table] ?? table}</span>
                  <span class="admin-table-rowcounts-count">{count.toLocaleString("en-GB")}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section>
        <h2>Users</h2>
        {usersError && <p class="admin-error">Failed to load users.</p>}
        {!usersError && !users && <p class="admin-muted">Loading…</p>}
        {users && users.length === 0 && <p class="admin-muted">No users yet.</p>}
        {users && users.length > 0 && (
          <>
            <div class="admin-table-wrap">
            <table class="admin-table">
              <thead>
                <tr>
                  <th>Email</th>
                  <th>Status</th>
                  <th>Signed up</th>
                  <th>Saved locations</th>
                </tr>
              </thead>
              <tbody>
                {users.map((user) => (
                  <tr key={user.id}>
                    <td>{user.email ?? <em class="admin-muted">no email</em>}</td>
                    <td>
                      <span class={`status-badge ${STATUS_BADGE_CLASS[user.subscriptionStatus] ?? "status-badge-free"}`}>
                        {STATUS_LABELS[user.subscriptionStatus] ?? user.subscriptionStatus}
                      </span>
                    </td>
                    <td>{formatDate(user.createdAt)}</td>
                    <td class="admin-table-num">{user.savedPointCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            <div class="admin-pagination">
              <button type="button" onClick={() => setPage((p) => p - 1)} disabled={page <= 1}>
                Previous
              </button>
              <span>
                Page {page} of {totalPages} ({total} total)
              </span>
              <button type="button" onClick={() => setPage((p) => p + 1)} disabled={page >= totalPages}>
                Next
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
