import { useEffect, useState } from "preact/hooks";
import { getAdminDb, getAdminStats, getAdminTrends, getAdminUsers } from "./api";
import type { AdminDbOverview, AdminStats, AdminTrends, AdminUser } from "./api";
import { StackedBarChart } from "./StackedBarChart";
import type { ChartSeries } from "./StackedBarChart";

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

// A categorical palette distinct from the semantic status/accent colors used elsewhere on the
// page (those mean "good/bad/neutral"; these seven just need to stay visually distinct from
// each other across two different charts that both break hazards down by type).
const HAZARD_TYPE_COLORS: Record<string, string> = {
  slippery: "#4da8ff",
  obstacle: "#ff6b60",
  accident: "#e0b23d",
  roadworks: "#ff9f43",
  reduced_visibility: "#9b59b6",
  blockage: "#34c77b",
  weather: "#64748b",
};

const HAZARD_CHART_SERIES: ChartSeries[] = Object.keys(HAZARD_TYPE_LABELS).map((key) => ({
  key,
  label: HAZARD_TYPE_LABELS[key],
  color: HAZARD_TYPE_COLORS[key],
}));

const CYCLE_HEALTH_SERIES: ChartSeries[] = [
  { key: "infoCount", label: "OK", color: "var(--color-success)" },
  { key: "issueCount", label: "Issue", color: "var(--color-danger)" },
];

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

// Tables whose count already has its own card in Overview/Live data above (users,
// saved_points, push_subscriptions, hazards, restrictions, cameras, weather_stations,
// vms_signs) — the Database section's row-count list excludes these so it doesn't just repeat
// the same numbers a second time; what's left is genuinely only visible there.
const TABLES_SHOWN_ELSEWHERE = new Set([
  "users",
  "saved_points",
  "push_subscriptions",
  "hazards",
  "restrictions",
  "cameras",
  "weather_stations",
  "vms_signs",
]);

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
  const [trends, setTrends] = useState<AdminTrends | null>(null);
  const [trendsError, setTrendsError] = useState(false);
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
    getAdminTrends()
      .then(setTrends)
      .catch(() => setTrendsError(true));
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
  const sortedTables = db
    ? Object.entries(db.tableRowCounts)
        .filter(([table]) => !TABLES_SHOWN_ELSEWHERE.has(table))
        .sort(([, a], [, b]) => b - a)
    : [];

  return (
    <div class="admin-app">
      <h1>Teesilm Admin</h1>

      <section>
        <h2>Overview</h2>
        {statsError && <p class="admin-error">Failed to load stats.</p>}
        {!statsError && !stats && <p class="admin-muted">Loading…</p>}
        {stats && (
          <>
            <div class="admin-stat-grid">
              <div class="admin-stat-card">
                <span class="admin-stat-value">{totalUsers}</span>
                <span class="admin-stat-label">Total users</span>
                <ul class="admin-breakdown-list admin-breakdown-list--nested">
                  {(["free", "active", "canceled", "lifetime"] as const).map((status) => (
                    <li key={status}>
                      <span class={`admin-breakdown-dot admin-breakdown-dot--${STATUS_CARD_VARIANT[status]}`} />
                      <span class="admin-breakdown-label">{STATUS_LABELS[status]}</span>
                      <span class="admin-breakdown-value">{stats.usersByStatus[status] ?? 0}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div class="admin-stat-card admin-stat-card--accent">
                <span class="admin-stat-value">{stats.totalSavedPoints}</span>
                <span class="admin-stat-label">Saved locations</span>
              </div>
              <div class="admin-stat-card admin-stat-card--accent">
                <span class="admin-stat-value">{stats.totalPushSubscriptions}</span>
                <span class="admin-stat-label">Push subscriptions</span>
              </div>
              <div class="admin-stat-card admin-stat-card--danger">
                <span class="admin-stat-value">{activeHazardsTotal}</span>
                <span class="admin-stat-label">Active hazards</span>
                {Object.keys(stats.activeHazardsByType).length > 0 && (
                  <ul class="admin-breakdown-list admin-breakdown-list--nested">
                    {Object.entries(stats.activeHazardsByType).map(([type, count]) => (
                      <li key={type}>
                        <span class="admin-breakdown-label">{HAZARD_TYPE_LABELS[type] ?? type}</span>
                        <span class="admin-breakdown-value">{count}</span>
                      </li>
                    ))}
                  </ul>
                )}
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
        <h2>Trends</h2>
        {trendsError && <p class="admin-error">Failed to load trends.</p>}
        {!trendsError && !trends && <p class="admin-muted">Loading…</p>}
        {trends && (
          <div class="admin-chart-grid">
            <div>
              <h3 class="admin-chart-title">Active hazards by day</h3>
              <StackedBarChart data={trends.hazardsByDay} series={HAZARD_CHART_SERIES} />
            </div>
            <div>
              <h3 class="admin-chart-title">Cycle health by day</h3>
              <StackedBarChart data={trends.cycleHealthByDay} series={CYCLE_HEALTH_SERIES} />
            </div>
            <div>
              <h3 class="admin-chart-title">Hazard feed errors by day</h3>
              <StackedBarChart data={trends.feedErrorsByDay} series={HAZARD_CHART_SERIES} />
            </div>
          </div>
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
