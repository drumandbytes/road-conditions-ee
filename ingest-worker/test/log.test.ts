import type { Pipeline } from "cloudflare:pipelines";
import { describe, expect, it, vi } from "vitest";
import { log, sendToStream } from "../src/log";

describe("log.ts", () => {
  it("builds a structured entry and returns it", () => {
    const entry = log("INFO", "pollFast", { steps: { weatherReadings: { ok: true } } });

    expect(entry.level).toBe("INFO");
    expect(entry.event).toBe("pollFast");
    expect(entry.steps).toEqual({ weatherReadings: { ok: true } });
    expect(entry.ts).toEqual(expect.any(String));
  });

  it("sends the entry to the pipeline stream as a single-element batch", async () => {
    const sendCalls: unknown[][] = [];
    const stream = { send: async (records: unknown[]) => { sendCalls.push(records); } } as unknown as Pipeline;
    const entry = { ts: "2026-07-26T11:30:34.941Z", level: "WARN" as const, event: "pollFast" };

    await sendToStream(stream, entry);

    expect(sendCalls).toEqual([[entry]]);
  });

  it("swallows a rejected send so a transient pipeline error can't fail the poll cycle", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const stream = {
      send: async () => { throw new Error("Internal error in Durable Object storage caused object to be reset"); },
    } as unknown as Pipeline;

    await expect(
      sendToStream(stream, { ts: "2026-07-26T11:30:34.941Z", level: "WARN", event: "pollFast" }),
    ).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalledOnce();

    consoleError.mockRestore();
  });
});
