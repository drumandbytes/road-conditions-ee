import { describe, expect, it } from "vitest";
import { getAdminStats, getAdminUserCount, getAdminUsers } from "../src/db";

/** Returns canned results to successive db.prepare(...) calls, in the exact order the function
 *  under test is expected to make them — works whether the call chain is
 *  prepare().all()/.first() directly (no params) or prepare().bind(...).all()/.first()
 *  (params), since both are real, ordinary D1 usage depending on whether a query has params. */
function sequentialDb(responses: Array<{ all?: unknown[]; first?: unknown }>): D1Database {
  let i = 0;
  return {
    prepare: () => {
      const response = responses[i++] ?? {};
      const terminal = {
        all: async () => ({ results: response.all ?? [] }),
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
