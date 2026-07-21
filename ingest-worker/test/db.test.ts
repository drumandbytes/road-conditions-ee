import { describe, expect, it } from "vitest";
import { upsertHazardsAndGetChanged } from "../src/db";
import type { HazardRecord } from "../src/tarktee";

function hazard(overrides: Partial<HazardRecord> = {}): HazardRecord {
  return {
    externalId: "h1",
    eventType: "slippery",
    lat: 59.4,
    lng: 24.7,
    description: "Icy patch",
    startsAt: null,
    endsAt: null,
    rawJson: '{"v":1}',
    ...overrides,
  };
}

/** Minimal fake covering exactly the three query shapes upsertHazardsAndGetChanged issues —
 *  a full-table SELECT (no bind), a batched INSERT (via .bind() then db.batch()), and a
 *  DELETE ... IN (...) (via .bind() then .run()). Records what each ends up doing so tests can
 *  assert on it directly, the same shape as api-worker/test/routes.test.ts's fakeDb helpers. */
function fakeHazardsDb(existingRows: { external_id: string; raw_json: string }[]) {
  const insertedExternalIds: string[] = [];
  let deletedIds: string[] | null = null;

  const db = {
    prepare(sql: string) {
      if (sql.startsWith("SELECT")) {
        return { all: async () => ({ results: existingRows }) };
      }
      if (sql.startsWith("INSERT")) {
        return {
          bind: (...args: unknown[]) => {
            insertedExternalIds.push(args[0] as string);
            return {};
          },
        };
      }
      if (sql.startsWith("DELETE")) {
        return {
          bind: (...ids: unknown[]) => ({
            run: async () => {
              deletedIds = ids as string[];
              return { success: true };
            },
          }),
        };
      }
      throw new Error(`fakeHazardsDb: unexpected SQL: ${sql}`);
    },
    batch: async (statements: unknown[]) => statements.map(() => ({ success: true })),
  } as unknown as D1Database;

  return { db, insertedExternalIds, getDeletedIds: () => deletedIds };
}

describe("upsertHazardsAndGetChanged", () => {
  it("writes only hazards whose raw_json changed, not ones that are identical to what's stored", async () => {
    const { db, insertedExternalIds } = fakeHazardsDb([
      { external_id: "h1", raw_json: '{"v":1}' }, // unchanged below
    ]);

    const changed = await upsertHazardsAndGetChanged(db, [
      hazard({ externalId: "h1", rawJson: '{"v":1}' }), // identical — should not be written
      hazard({ externalId: "h2", rawJson: '{"v":2}' }), // new — should be written
    ]);

    expect(insertedExternalIds).toEqual(["h2"]);
    expect(changed.map((h) => h.externalId)).toEqual(["h2"]);
  });

  it("deletes hazards that disappeared from the feed (resolved/expired)", async () => {
    const { db, getDeletedIds } = fakeHazardsDb([
      { external_id: "h1", raw_json: '{"v":1}' },
      { external_id: "h2", raw_json: '{"v":1}' },
    ]);

    // Only h1 is still present this poll — h2 must be treated as resolved and deleted.
    await upsertHazardsAndGetChanged(db, [hazard({ externalId: "h1", rawJson: '{"v":1}' })]);

    expect(getDeletedIds()).toEqual(["h2"]);
  });

  it("does not touch the table when everything from the last poll is still present", async () => {
    const { db, getDeletedIds } = fakeHazardsDb([{ external_id: "h1", raw_json: '{"v":1}' }]);

    await upsertHazardsAndGetChanged(db, [hazard({ externalId: "h1", rawJson: '{"v":1}' })]);

    expect(getDeletedIds()).toBeNull();
  });

  it("deletes every existing row when the feed genuinely returns nothing", async () => {
    const { db, getDeletedIds } = fakeHazardsDb([
      { external_id: "h1", raw_json: '{"v":1}' },
      { external_id: "h2", raw_json: '{"v":1}' },
    ]);

    // This is the correct behavior for a real empty feed (see index.ts's pollFast, which
    // guards the actually-dangerous case — TARKTEE_API_KEY unset — by skipping this call
    // entirely rather than calling it with an empty array).
    await upsertHazardsAndGetChanged(db, []);

    expect(getDeletedIds()).toEqual(["h1", "h2"]);
  });
});
