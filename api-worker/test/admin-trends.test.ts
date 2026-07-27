import { afterEach, describe, expect, it, vi } from "vitest";
import { getAdminTrends } from "../src/routes/admin-trends";

// getAdminTrends fires its 3 queries via Promise.all in array-literal order (hazards, health,
// feedErrors), so a fetch mock returning canned responses by call index lines up reliably —
// each query's fetch() is issued synchronously before any of them resolve.
function sequentialFetch(responses: unknown[]) {
  let i = 0;
  return vi.fn().mockImplementation(
    async () => new Response(JSON.stringify(responses[i++]), { status: 200, headers: { "Content-Type": "application/json" } }),
  );
}

describe("getAdminTrends", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shapes all three query results into the AdminTrends response", async () => {
    const fetchMock = sequentialFetch([
      { result: { rows: [{ day: "2026-07-27T00:00:00.000000Z", obstacle: 17, roadworks: 5 }] }, success: true, errors: [] },
      { result: { rows: [{ day: "2026-07-27T00:00:00.000000Z", info_count: 11, issue_count: 1 }] }, success: true, errors: [] },
      { result: { rows: [{ day: "2026-07-27T00:00:00.000000Z", obstacle: 0, slippery: 2 }] }, success: true, errors: [] },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const trends = await getAdminTrends({ accountId: "acct1", token: "tok1", bucket: "my-bucket" });

    expect(trends.hazardsByDay).toEqual([
      {
        day: "2026-07-27",
        slippery: 0,
        obstacle: 17,
        accident: 0,
        roadworks: 5,
        reduced_visibility: 0,
        blockage: 0,
        weather: 0,
      },
    ]);
    expect(trends.cycleHealthByDay).toEqual([{ day: "2026-07-27", infoCount: 11, issueCount: 1 }]);
    expect(trends.feedErrorsByDay).toEqual([
      {
        day: "2026-07-27",
        slippery: 2,
        obstacle: 0,
        accident: 0,
        roadworks: 0,
        reduced_visibility: 0,
        blockage: 0,
        weather: 0,
      },
    ]);
  });

  it("returns empty arrays for all three trends when there's no data yet", async () => {
    const fetchMock = sequentialFetch([
      { result: { rows: [] }, success: true, errors: [] },
      { result: { rows: [] }, success: true, errors: [] },
      { result: { rows: [] }, success: true, errors: [] },
    ]);
    vi.stubGlobal("fetch", fetchMock);

    const trends = await getAdminTrends({ accountId: "acct1", token: "tok1", bucket: "my-bucket" });

    expect(trends).toEqual({ hazardsByDay: [], cycleHealthByDay: [], feedErrorsByDay: [] });
  });
});
