// Same shape/pattern as cloudflare-workers/vault-worker's own log()/persistLog() — one JSON
// object per persisted event, written directly to R2 (no Logpush, which needs a
// Business/Enterprise plan we're not on) at a key partitioned by day, so the bucket can later
// have R2 Data Catalog enabled on it and be queried with R2 SQL.

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

export async function persistLog(bucket: R2Bucket, entry: LogEntry): Promise<void> {
  const date = entry.ts.slice(0, 10);
  const ts = entry.ts.replace(/[:.]/g, "-");
  const key = `${date}/${ts}_${entry.event}.json`;
  await bucket.put(key, JSON.stringify(entry), { httpMetadata: { contentType: "application/json" } });
}
