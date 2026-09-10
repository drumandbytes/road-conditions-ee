// Structured per-cycle logging — one entry per poll cycle, sent to the ingest_worker_logs
// Pipeline, which lands it as a real row in the road-conditions-logs bucket's R2 Data Catalog
// Iceberg table (ingest_worker.cycle_logs_v2), queryable with R2 SQL. Previously wrote one raw
// JSON object per R2 write instead (see git history) — replaced once this was confirmed
// working end-to-end with real production cycles, since keeping both stored the same data
// twice for no benefit.

import type { Pipeline } from "cloudflare:pipelines";

export type LogLevel = "INFO" | "WARN" | "ERROR";

export interface LogEntry {
  ts: string;
  level: LogLevel;
  event: string;
  step?: string;
  error?: string;
  [key: string]: unknown;
}

export function log(level: LogLevel, event: string, extra: Record<string, unknown> = {}): LogEntry {
  const entry: LogEntry = { ts: new Date().toISOString(), level, event, ...extra };
  const line = JSON.stringify(entry);
  if (level === "ERROR") console.error(line);
  else if (level === "WARN") console.warn(line);
  else console.log(line);
  return entry;
}

export async function sendToStream(stream: Pipeline, entry: LogEntry): Promise<void> {
  // Best-effort: Pipelines is DO-backed, so a transient "Durable Object storage caused
  // object to be reset" surfaces here. Dropping one cycle summary is fine (the next poll
  // writes a fresh one) — it must not fail the whole scheduled run. A sustained failure
  // still shows up via this console.error in observability.
  // ponytail: swallow-and-log, no retry — the 3/30-min cron cadence is the retry.
  try {
    await stream.send([entry]);
  } catch (err) {
    console.error(
      JSON.stringify({
        ts: new Date().toISOString(),
        level: "ERROR",
        event: "sendToStream.failed",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }
}
