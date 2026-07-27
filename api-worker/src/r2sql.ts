// R2 SQL's HTTP API — read-only queries over the R2 Data Catalog Iceberg tables that
// ingest-worker's Pipeline writes into (see ingest-worker/src/log.ts). No wrangler CLI
// involved; this calls the documented endpoint directly since it's just a POST + bearer token.
// https://developers.cloudflare.com/r2-sql/query-data/

export interface R2SqlRow {
  [column: string]: unknown;
}

interface R2SqlResponse {
  result: { rows: R2SqlRow[] } | null;
  success: boolean;
  errors: Array<{ code: number; message: string }>;
}

export async function queryR2Sql(
  accountId: string,
  token: string,
  bucket: string,
  query: string,
): Promise<R2SqlRow[]> {
  const res = await fetch(`https://api.sql.cloudflarestorage.com/api/v1/accounts/${accountId}/r2-sql/query/${bucket}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
  const body = await res.json<R2SqlResponse>();
  if (!res.ok || !body.success) {
    throw new Error(`R2 SQL query failed: ${body.errors.map((e) => e.message).join("; ") || res.statusText}`);
  }
  return body.result?.rows ?? [];
}
