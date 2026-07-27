import type { Pipeline } from "cloudflare:pipelines";
import { describe, expect, it } from "vitest";
import { log, persistLog, sendToStream } from "../src/log";

describe("log.ts", () => {
  it("builds a structured entry and returns it", () => {
    const entry = log("INFO", "pollFast", { steps: { weatherReadings: { ok: true } } });

    expect(entry.level).toBe("INFO");
    expect(entry.event).toBe("pollFast");
    expect(entry.steps).toEqual({ weatherReadings: { ok: true } });
    expect(entry.ts).toEqual(expect.any(String));
  });

  // Regression-proofing: a wrong key format would silently misfile entries in R2 with no
  // error anywhere, so the exact shape is worth locking in — day-prefixed for cheap date-range
  // listing, colons/dots stripped since they're awkward in R2 object keys.
  it("writes to a date-prefixed key with colons/dots stripped from the timestamp", async () => {
    const putCalls: Array<[string, string, unknown]> = [];
    const bucket = {
      put: async (key: string, value: string, options: unknown) => {
        putCalls.push([key, value, options]);
      },
    } as unknown as R2Bucket;

    await persistLog(bucket, { ts: "2026-07-26T11:30:34.941Z", level: "WARN", event: "pollFast" });

    expect(putCalls).toHaveLength(1);
    const [key, value, options] = putCalls[0];
    expect(key).toBe("2026-07-26/2026-07-26T11-30-34-941Z_pollFast.json");
    expect(JSON.parse(value)).toEqual({ ts: "2026-07-26T11:30:34.941Z", level: "WARN", event: "pollFast" });
    expect(options).toEqual({ httpMetadata: { contentType: "application/json" } });
  });

  it("sends the entry to the pipeline stream as a single-element batch", async () => {
    const sendCalls: unknown[][] = [];
    const stream = { send: async (records: unknown[]) => { sendCalls.push(records); } } as unknown as Pipeline;
    const entry = { ts: "2026-07-26T11:30:34.941Z", level: "WARN" as const, event: "pollFast" };

    await sendToStream(stream, entry);

    expect(sendCalls).toEqual([[entry]]);
  });
});
