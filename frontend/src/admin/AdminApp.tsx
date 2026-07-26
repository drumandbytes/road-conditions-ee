import { useEffect, useState } from "preact/hooks";
import { getAdminStats, getAdminUsers } from "./api";
import type { AdminStats, AdminUser } from "./api";

const STATUS_LABELS: Record<string, string> = {
  free: "Free",
  active: "Active",
  canceled: "Canceled",
  lifetime: "Lifetime",
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

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { year: "numeric", month: "short", day: "numeric" });
}

export function AdminApp() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [statsError, setStatsError] = useState(false);
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

  return (
    <div class="admin-app">
      <h1>Teesilm Admin</h1>

      <section>
        <h2>Overview</h2>
        {statsError && <p class="admin-error">Failed to load stats.</p>}
        {!statsError && !stats && <p class="admin-muted">Loading…</p>}
        {stats && (
          <div class="admin-stat-grid">
            {(["free", "active", "canceled", "lifetime"] as const).map((status) => (
              <div class="admin-stat-card" key={status}>
                <span class="admin-stat-value">{stats.usersByStatus[status] ?? 0}</span>
                <span class="admin-stat-label">{STATUS_LABELS[status]}</span>
              </div>
            ))}
            <div class="admin-stat-card">
              <span class="admin-stat-value">{stats.totalSavedPoints}</span>
              <span class="admin-stat-label">Saved locations</span>
            </div>
            <div class="admin-stat-card">
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
              <div class="admin-stat-card">
                <span class="admin-stat-value">
                  {Object.values(stats.activeHazardsByType).reduce((sum, n) => sum + n, 0)}
                </span>
                <span class="admin-stat-label">Active hazards</span>
              </div>
              <div class="admin-stat-card">
                <span class="admin-stat-value">{stats.totalRestrictions}</span>
                <span class="admin-stat-label">Roadworks & restrictions</span>
              </div>
              <div class="admin-stat-card">
                <span class="admin-stat-value">{stats.totalCameras}</span>
                <span class="admin-stat-label">Cameras</span>
              </div>
              <div class="admin-stat-card">
                <span class="admin-stat-value">{stats.totalWeatherStations}</span>
                <span class="admin-stat-label">Weather stations</span>
              </div>
              <div class="admin-stat-card">
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
        <h2>Users</h2>
        {usersError && <p class="admin-error">Failed to load users.</p>}
        {!usersError && !users && <p class="admin-muted">Loading…</p>}
        {users && users.length === 0 && <p class="admin-muted">No users yet.</p>}
        {users && users.length > 0 && (
          <>
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
                    <td>{STATUS_LABELS[user.subscriptionStatus] ?? user.subscriptionStatus}</td>
                    <td>{formatDate(user.createdAt)}</td>
                    <td>{user.savedPointCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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
