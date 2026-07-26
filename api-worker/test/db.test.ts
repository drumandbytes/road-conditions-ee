import { describe, expect, it } from "vitest";
import { getAdminDbOverview, getAdminStats, getAdminUserCount, getAdminUsers } from "../src/db";

/** Returns canned results to successive db.prepare(...) calls, in the exact order the function
 *  under test is expected to make them — works whether the call chain is
 *  prepare().all()/.first() directly (no params) or prepare().bind(...).all()/.first()
 *  (params), since both are real, ordinary D1 usage depending on whether a query has params. */
function sequentialDb(responses: Array<{ all?: unknown[]; first?: unknown; meta?: unknown }>): D1Database {
  let i = 0;
  return {
    prepare: () => {
      const response = responses[i++] ?? {};
      const terminal = {
        all: async () => ({ results: response.all ?? [], meta: response.meta ?? {} }),
        first: async () => response.first ?? null,
      };
      return { ...terminal, bind: () => terminal };
    },
  } as unknown as D1Database;
}

describe("getAdminStats", () => {
  it("shapes user-status counts, saved/push totals, and active-hazard-by-type counts", async () => {
    const db = sequentialDb([
      { all: [{ subscription_status: "free", n: 3 }, { subscription_status: "active", n: 2 }] }, // users by status
      { first: { n: 5 } }, // saved_points
      { first: { n: 1 } }, // push_subscriptions
      { all: [{ event_type: "obstacle", n: 8 }, { event_type: "roadworks", n: 1 }] }, // active hazards
      { first: { n: 40 } }, // restrictions
      { first: { n: 178 } }, // cameras
      { first: { n: 117 } }, // weather_stations
      { first: { n: 12 } }, // vms_signs
    ]);

    const stats = await getAdminStats(db);

    expect(stats).toEqual({
      usersByStatus: { free: 3, active: 2 },
      totalSavedPoints: 5,
      totalPushSubscriptions: 1,
      activeHazardsByType: { obstacle: 8, roadworks: 1 },
      totalRestrictions: 40,
      totalCameras: 178,
      totalWeatherStations: 117,
      totalVmsSigns: 12,
    });
  });

  it("defaults counts to 0 when a query returns no row", async () => {
    const db = sequentialDb([{ all: [] }, {}, {}, { all: [] }, {}, {}, {}, {}]);

    const stats = await getAdminStats(db);

    expect(stats.totalSavedPoints).toBe(0);
    expect(stats.totalRestrictions).toBe(0);
    expect(stats.activeHazardsByType).toEqual({});
  });
});

describe("getAdminDbOverview", () => {
  it("returns a row count for every table plus the database's total size", async () => {
    // 13 tables in shared/schema.sql — order matches ALL_TABLES in db.ts.
    const db = sequentialDb([
      { all: [{ n: 2 }], meta: { size_after: 1000 } }, // users
      { all: [{ n: 5 }], meta: { size_after: 1000 } }, // login_tokens
      { all: [{ n: 1 }], meta: { size_after: 1000 } }, // email_preferences
      { all: [{ n: 1 }], meta: { size_after: 1000 } }, // push_subscriptions
      { all: [{ n: 2 }], meta: { size_after: 1000 } }, // saved_points
      { all: [{ n: 14 }], meta: { size_after: 1000 } }, // hazards
      { all: [{ n: 150 }], meta: { size_after: 1000 } }, // vms_signs
      { all: [{ n: 117 }], meta: { size_after: 1000 } }, // weather_stations
      { all: [{ n: 402 }], meta: { size_after: 1000 } }, // restrictions
      { all: [{ n: 0 }], meta: { size_after: 1000 } }, // translations
      { all: [{ n: 5000 }], meta: { size_after: 1000 } }, // weather_station_history
      { all: [{ n: 3 }], meta: { size_after: 1000 } }, // detours
      { all: [{ n: 179 }], meta: { size_after: 3801088 } }, // cameras (last query, used for size)
    ]);

    const overview = await getAdminDbOverview(db);

    expect(overview.sizeBytes).toBe(3801088);
    expect(overview.tableRowCounts).toEqual({
      users: 2,
      login_tokens: 5,
      email_preferences: 1,
      push_subscriptions: 1,
      saved_points: 2,
      hazards: 14,
      vms_signs: 150,
      weather_stations: 117,
      restrictions: 402,
      translations: 0,
      weather_station_history: 5000,
      detours: 3,
      cameras: 179,
    });
  });
});

describe("getAdminUsers / getAdminUserCount", () => {
  it("maps rows to AdminUserRow shape", async () => {
    const db = sequentialDb([
      {
        all: [
          { id: "u1", email: "a@example.com", subscription_status: "active", created_at: "2026-01-01", saved_point_count: 2 },
        ],
      },
    ]);

    const users = await getAdminUsers(db, 50, 0);

    expect(users).toEqual([
      { id: "u1", email: "a@example.com", subscription_status: "active", created_at: "2026-01-01", saved_point_count: 2 },
    ]);
  });

  it("returns 0 for an empty users table", async () => {
    const db = sequentialDb([{}]);
    const count = await getAdminUserCount(db);
    expect(count).toBe(0);
  });
});
