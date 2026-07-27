import { queryR2Sql } from "../r2sql";

// Mirrors ingest-worker's HazardEventType (src/tarktee.ts) — the perFeed keys inside a
// pollFast cycle's steps.hazards JSON blob.
const HAZARD_TYPES = ["slippery", "obstacle", "accident", "roadworks", "reduced_visibility", "blockage", "weather"];

const TREND_WINDOW_DAYS = 30;

// `day` (a date string) plus one number per hazard type (see HAZARD_TYPES) — a nominal
// interface can't express "this one key is a string, the rest are numbers" cleanly, so this
// is deliberately loose; consumers know `day` is the date and everything else is a count.
export type HazardCountsByDay = Record<string, string | number>;

export interface AdminTrends {
  // Per day: peak (max-in-a-cycle) active count per hazard type, from pollFast cycles.
  hazardsByDay: HazardCountsByDay[];
  // Per day: how many cycles (pollFast + pollSlow combined) logged at INFO vs WARN/ERROR.
  cycleHealthByDay: Array<{ day: string; infoCount: number; issueCount: number }>;
  // Per day: how many pollFast cycles had a given hazard feed report an error.
  feedErrorsByDay: HazardCountsByDay[];
}

interface R2SqlConfig {
  accountId: string;
  token: string;
  bucket: string;
}

export async function getAdminTrends(config: R2SqlConfig): Promise<AdminTrends> {
  const hazardColumns = HAZARD_TYPES.map(
    (type) => `MAX(json_get_int(steps, 'hazards', 'perFeed', '${type}', 'usable')) AS ${type}`,
  ).join(", ");
  const feedErrorColumns = HAZARD_TYPES.map(
    (type) =>
      `COUNT(*) FILTER (WHERE json_get(steps, 'hazards', 'perFeed', '${type}', 'error') IS NOT NULL) AS ${type}`,
  ).join(", ");

  const [hazardRows, healthRows, feedErrorRows] = await Promise.all([
    queryR2Sql(
      config.accountId,
      config.token,
      config.bucket,
      `SELECT date_trunc('day', ts) AS day, ${hazardColumns}
       FROM ingest_worker.cycle_logs
       WHERE event = 'pollFast' AND ts > now() - INTERVAL '${TREND_WINDOW_DAYS} days'
       GROUP BY date_trunc('day', ts)
       ORDER BY day`,
    ),
    queryR2Sql(
      config.accountId,
      config.token,
      config.bucket,
      `SELECT date_trunc('day', ts) AS day,
              COUNT(*) FILTER (WHERE level = 'INFO') AS info_count,
              COUNT(*) FILTER (WHERE level != 'INFO') AS issue_count
       FROM ingest_worker.cycle_logs
       WHERE ts > now() - INTERVAL '${TREND_WINDOW_DAYS} days'
       GROUP BY date_trunc('day', ts)
       ORDER BY day`,
    ),
    queryR2Sql(
      config.accountId,
      config.token,
      config.bucket,
      `SELECT date_trunc('day', ts) AS day, ${feedErrorColumns}
       FROM ingest_worker.cycle_logs
       WHERE event = 'pollFast' AND ts > now() - INTERVAL '${TREND_WINDOW_DAYS} days'
       GROUP BY date_trunc('day', ts)
       ORDER BY day`,
    ),
  ]);

  return {
    hazardsByDay: hazardRows.map((row) => ({ day: String(row.day).slice(0, 10), ...pickHazardCounts(row) })),
    cycleHealthByDay: healthRows.map((row) => ({
      day: String(row.day).slice(0, 10),
      infoCount: Number(row.info_count ?? 0),
      issueCount: Number(row.issue_count ?? 0),
    })),
    feedErrorsByDay: feedErrorRows.map((row) => ({ day: String(row.day).slice(0, 10), ...pickHazardCounts(row) })),
  };
}

function pickHazardCounts(row: Record<string, unknown>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const type of HAZARD_TYPES) counts[type] = Number(row[type] ?? 0);
  return counts;
}

export async function handleAdminTrends(config: R2SqlConfig): Promise<Response> {
  const trends = await getAdminTrends(config);
  return Response.json(trends);
}
