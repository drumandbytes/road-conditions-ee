import { describe, expect, it, vi } from "vitest";
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
    contentHash: "v1",
    rawJson: "{}",
    ...overrides,
  };
}

/** Minimal fake covering exactly the three query shapes upsertHazardsAndGetChanged issues —
 *  a full-table SELECT (no bind), a batched INSERT (via .bind() then db.batch()), and a
 *  DELETE ... IN (...) (via .bind() then .run()). Records what each ends up doing so tests can
 *  assert on it directly, the same shape as api-worker/test/routes.test.ts's fakeDb helpers. */
function fakeHazardsDb(existingRows: { external_id: string; content_hash: string }[]) {
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
              deletedIds = [...((deletedIds as string[] | null) ?? []), ...(ids as string[])];
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
  it("writes only hazards whose content_hash changed, not ones identical to what's stored", async () => {
    const { db, insertedExternalIds } = fakeHazardsDb([
      { external_id: "h1", content_hash: "v1" }, // unchanged below
    ]);

    const changed = await upsertHazardsAndGetChanged(db, [
      hazard({ externalId: "h1", contentHash: "v1" }), // identical — should not be written
      hazard({ externalId: "h2", contentHash: "v2" }), // new — should be written
    ]);

    expect(insertedExternalIds).toEqual(["h2"]);
    expect(changed.map((h) => h.externalId)).toEqual(["h2"]);
  });

  it("collapses two records that map to the same synthetic key, last one wins", async () => {
    const { db, insertedExternalIds } = fakeHazardsDb([]);

    const changed = await upsertHazardsAndGetChanged(db, [
      hazard({ externalId: "obstacle:59:24", contentHash: "a" }),
      hazard({ externalId: "obstacle:59:24", contentHash: "b" }),
    ]);

    expect(insertedExternalIds).toEqual(["obstacle:59:24"]);
    expect(changed).toHaveLength(1);
    expect(changed[0].contentHash).toBe("b");
  });

  it("deletes hazards that disappeared from the feed (resolved/expired)", async () => {
    const { db, getDeletedIds } = fakeHazardsDb([
      { external_id: "h1", content_hash: "v1" },
      { external_id: "h2", content_hash: "v1" },
    ]);

    // Only h1 is still present this poll — h2 must be treated as resolved and deleted.
    await upsertHazardsAndGetChanged(db, [hazard({ externalId: "h1", contentHash: "v1" })]);

    expect(getDeletedIds()).toEqual(["h2"]);
  });

  it("does not touch the table when everything from the last poll is still present", async () => {
    const { db, getDeletedIds } = fakeHazardsDb([{ external_id: "h1", content_hash: "v1" }]);

    await upsertHazardsAndGetChanged(db, [hazard({ externalId: "h1", contentHash: "v1" })]);

    expect(getDeletedIds()).toBeNull();
  });

  it("deletes every existing row when the feed genuinely returns nothing", async () => {
    const { db, getDeletedIds } = fakeHazardsDb([
      { external_id: "h1", content_hash: "v1" },
      { external_id: "h2", content_hash: "v1" },
    ]);

    await upsertHazardsAndGetChanged(db, []);

    expect(getDeletedIds()).toEqual(["h1", "h2"]);
  });

  it("keeps disappeared rows when pruneDisappeared is false (a feed failed this poll)", async () => {
    const { db, getDeletedIds } = fakeHazardsDb([
      { external_id: "h1", content_hash: "v1" },
      { external_id: "h2", content_hash: "v1" },
    ]);

    await upsertHazardsAndGetChanged(db, [], { pruneDisappeared: false });

    expect(getDeletedIds()).toBeNull();
  });

  it("chunks the disappeared-row delete so it can't exceed D1's parameter limit", async () => {
    const existing = Array.from({ length: 300 }, (_, i) => ({ external_id: `h${i}`, content_hash: "v1" }));
    const { db, getDeletedIds } = fakeHazardsDb(existing);

    // 100 gone (< 50%, so not treated as a glitch), spread across 2 DELETE statements at chunk size 90.
    const stillPresent = existing.slice(0, 200).map((r) => hazard({ externalId: r.external_id, contentHash: "v1" }));
    await upsertHazardsAndGetChanged(db, stillPresent);

    expect(getDeletedIds()).toHaveLength(100);
  });

  it("skips the prune when more than half the table vanished in one poll (likely a feed glitch)", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const existing = Array.from({ length: 20 }, (_, i) => ({ external_id: `h${i}`, content_hash: "v1" }));
    const { db, getDeletedIds } = fakeHazardsDb(existing);

    // Only 5 of 20 still present — a 75% drop.
    const stillPresent = existing.slice(0, 5).map((r) => hazard({ externalId: r.external_id, contentHash: "v1" }));
    await upsertHazardsAndGetChanged(db, stillPresent);

    expect(getDeletedIds()).toBeNull();
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
