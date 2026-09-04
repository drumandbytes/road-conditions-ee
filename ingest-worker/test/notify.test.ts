import { afterEach, describe, expect, it, vi } from "vitest";
import type { HazardRecord } from "../src/tarktee";
import type { Restriction } from "../src/arcgis";

const dbMocks = vi.hoisted(() => ({
  getSavedPointsForMatching: vi.fn(),
  getPushSubscriptionsByUserIds: vi.fn(),
  markHazardsNotified: vi.fn(),
  markRestrictionsNotified: vi.fn(),
  deletePushSubscription: vi.fn(),
  recordPushFailure: vi.fn(),
}));
vi.mock("../src/db", () => dbMocks);

const sendWebPush = vi.hoisted(() => vi.fn());
vi.mock("../src/push", () => ({ sendWebPush }));

const { notifyMatchingSavedPoints } = await import("../src/notify");

const VAPID = { publicKey: "pub", privateKey: "priv" };

function hazard(overrides: Partial<HazardRecord> = {}): HazardRecord {
  return {
    externalId: "h1",
    eventType: "slippery",
    lat: 59.4,
    lng: 24.7,
    description: "Icy patch",
    startsAt: null,
    endsAt: null,
    contentHash: "v1",
    rawJson: "{}",
    ...overrides,
  };
}

function savedPointRow(overrides: Record<string, unknown> = {}) {
  return { id: 1, user_id: "u1", lat: 59.4, lng: 24.7, radius_km: 5, event_types: null, ...overrides };
}

function subscriptionRow(overrides: Record<string, unknown> = {}) {
  return { id: 1, user_id: "u1", endpoint: "https://push.example.com/a", p256dh: "x", auth: "y", failure_count: 0, ...overrides };
}

describe("notifyMatchingSavedPoints", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("does nothing when there are no changed hazards or restrictions", async () => {
    await notifyMatchingSavedPoints({} as D1Database, VAPID, [], [], { remaining: 15 });
    expect(dbMocks.getSavedPointsForMatching).not.toHaveBeenCalled();
  });

  it("skips entirely when VAPID keys aren't configured yet", async () => {
    await notifyMatchingSavedPoints({} as D1Database, null, [hazard()], [], { remaining: 15 });
    expect(dbMocks.getSavedPointsForMatching).not.toHaveBeenCalled();
  });

  it("does nothing (not even marking notified) when there are no saved points at all", async () => {
    dbMocks.getSavedPointsForMatching.mockResolvedValue([]);
    await notifyMatchingSavedPoints({} as D1Database, VAPID, [hazard()], [], { remaining: 15 });
    expect(sendWebPush).not.toHaveBeenCalled();
    // Early-returns before touching notified_at at all — cheap to just recheck next cycle
    // once someone actually has a saved point.
    expect(dbMocks.markHazardsNotified).not.toHaveBeenCalled();
  });

  it("marks a hazard notified even when saved points exist but none are within radius", async () => {
    dbMocks.getSavedPointsForMatching.mockResolvedValue([savedPointRow({ lat: 10, lng: 10 })]);
    await notifyMatchingSavedPoints({} as D1Database, VAPID, [hazard()], [], { remaining: 15 });
    expect(sendWebPush).not.toHaveBeenCalled();
    expect(dbMocks.markHazardsNotified).toHaveBeenCalledWith(expect.anything(), ["h1"]);
  });

  it("sends to a matching saved point's subscription and marks the hazard notified", async () => {
    dbMocks.getSavedPointsForMatching.mockResolvedValue([savedPointRow()]);
    dbMocks.getPushSubscriptionsByUserIds.mockResolvedValue([subscriptionRow()]);
    sendWebPush.mockResolvedValue({ success: true, statusCode: 201 });

    await notifyMatchingSavedPoints({} as D1Database, VAPID, [hazard()], [], { remaining: 15 });

    expect(sendWebPush).toHaveBeenCalledTimes(1);
    expect(sendWebPush).toHaveBeenCalledWith(
      { endpoint: "https://push.example.com/a", p256dh: "x", auth: "y" },
      expect.objectContaining({ title: "Libe tee" }),
      "pub",
      "priv",
    );
    expect(dbMocks.markHazardsNotified).toHaveBeenCalledWith(expect.anything(), ["h1"]);
  });

  it("respects the saved point's event_types filter", async () => {
    dbMocks.getSavedPointsForMatching.mockResolvedValue([savedPointRow({ event_types: '["accident"]' })]);
    dbMocks.getPushSubscriptionsByUserIds.mockResolvedValue([subscriptionRow()]);

    await notifyMatchingSavedPoints({} as D1Database, VAPID, [hazard({ eventType: "slippery" })], [], { remaining: 15 });

    expect(sendWebPush).not.toHaveBeenCalled();
    // No matches, but still handled — the point exists, it just doesn't want this category.
    expect(dbMocks.markHazardsNotified).toHaveBeenCalledWith(expect.anything(), ["h1"]);
  });

  it("stops entirely (no partial fan-out) when the budget can't cover every matched device", async () => {
    dbMocks.getSavedPointsForMatching.mockResolvedValue([
      savedPointRow({ id: 1, user_id: "u1" }),
      savedPointRow({ id: 2, user_id: "u2" }),
    ]);
    dbMocks.getPushSubscriptionsByUserIds.mockImplementation(async (_db: unknown, userIds: string[]) =>
      userIds.map((userId) => subscriptionRow({ id: userId, user_id: userId, endpoint: `https://push.example.com/${userId}` })),
    );

    const budget = { remaining: 1 };
    await notifyMatchingSavedPoints({} as D1Database, VAPID, [hazard()], [], budget);

    expect(sendWebPush).not.toHaveBeenCalled();
    // Called with an empty list — db.ts's real markHazardsNotified no-ops on an empty array;
    // what matters here is that "h1" specifically isn't in it.
    expect(dbMocks.markHazardsNotified).toHaveBeenCalledWith(expect.anything(), []);
    expect(budget.remaining).toBe(1);
  });

  it("deletes the subscription on a 410 response", async () => {
    dbMocks.getSavedPointsForMatching.mockResolvedValue([savedPointRow()]);
    dbMocks.getPushSubscriptionsByUserIds.mockResolvedValue([subscriptionRow({ id: 42 })]);
    sendWebPush.mockResolvedValue({ success: false, statusCode: 410 });

    await notifyMatchingSavedPoints({} as D1Database, VAPID, [hazard()], [], { remaining: 15 });

    expect(dbMocks.deletePushSubscription).toHaveBeenCalledWith(expect.anything(), 42);
    expect(dbMocks.recordPushFailure).not.toHaveBeenCalled();
    // Still marked notified — the item was fully handled, a dead subscription got cleaned up.
    expect(dbMocks.markHazardsNotified).toHaveBeenCalledWith(expect.anything(), ["h1"]);
  });

  it("records a failure (not a deletion) on a 5xx response", async () => {
    dbMocks.getSavedPointsForMatching.mockResolvedValue([savedPointRow()]);
    dbMocks.getPushSubscriptionsByUserIds.mockResolvedValue([subscriptionRow({ id: 42 })]);
    sendWebPush.mockResolvedValue({ success: false, statusCode: 503 });

    await notifyMatchingSavedPoints({} as D1Database, VAPID, [hazard()], [], { remaining: 15 });

    expect(dbMocks.recordPushFailure).toHaveBeenCalledWith(expect.anything(), 42);
    expect(dbMocks.deletePushSubscription).not.toHaveBeenCalled();
  });

  it("leaves the subscription untouched on a 429 (transient)", async () => {
    dbMocks.getSavedPointsForMatching.mockResolvedValue([savedPointRow()]);
    dbMocks.getPushSubscriptionsByUserIds.mockResolvedValue([subscriptionRow({ id: 42 })]);
    sendWebPush.mockResolvedValue({ success: false, statusCode: 429 });

    await notifyMatchingSavedPoints({} as D1Database, VAPID, [hazard()], [], { remaining: 15 });

    expect(dbMocks.deletePushSubscription).not.toHaveBeenCalled();
    expect(dbMocks.recordPushFailure).not.toHaveBeenCalled();
    expect(dbMocks.markHazardsNotified).toHaveBeenCalledWith(expect.anything(), ["h1"]);
  });

  it("includes matched restrictions alongside hazards, keyed by numeric id", async () => {
    dbMocks.getSavedPointsForMatching.mockResolvedValue([savedPointRow()]);
    dbMocks.getPushSubscriptionsByUserIds.mockResolvedValue([subscriptionRow()]);
    sendWebPush.mockResolvedValue({ success: true, statusCode: 201 });

    const restriction: Restriction = {
      id: 99,
      roadNr: 1,
      roadName: "Tallinna-Narva tee",
      roadType: null,
      cause: null,
      effect: "COMPLETE_CLOSURE",
      extraInfo: null,
      detourComment: null,
      contractorOrganization: null,
      contractorContactPhone: null,
      trafficCtrlOrganization: null,
      trafficCtrlContactPhone: null,
      dateFrom: null,
      dateTo: null,
      lat: 59.4,
      lng: 24.7,
    };

    await notifyMatchingSavedPoints({} as D1Database, VAPID, [], [restriction], { remaining: 15 });

    expect(sendWebPush).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ title: "Täielik sulgemine", body: "Tallinna-Narva tee lähedal" }),
      "pub",
      "priv",
    );
    expect(dbMocks.markRestrictionsNotified).toHaveBeenCalledWith(expect.anything(), [99]);
  });
});
