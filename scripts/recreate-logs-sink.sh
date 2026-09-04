#!/usr/bin/env bash
# Recreate the ingest-worker log Pipeline sink.
#
# Why this exists as a script: the Pipeline sink + pipeline SQL aren't declarable in
# wrangler.toml (only the stream binding is), so this infra was previously click-ops with no
# record. It also can't be *modified* — changing anything means delete + recreate.
#
# Why 6h roll interval: the original sink rolled every 300s, so the Iceberg table got a new
# snapshot + tiny Parquet file every 5 minutes (~288/day). Automatic snapshot expiration
# couldn't keep pace and the table grew to ~2.3 GB of metadata for ~15 MB of actual rows.
# 21600s = 4 commits/day; admin-trends only does 30-day daily rollups so sub-6h granularity is
# irrelevant.
#
# Sinks can't attach to an existing Iceberg table, so the table name changes on each recreate
# (cycle_logs -> cycle_logs_v2 -> ...). Update LOG_TABLE in api-worker/src/routes/admin-trends.ts
# to match. The old table stops receiving writes and drains via snapshot expiration.
#
# Requires: CF_CATALOG_TOKEN = API token with R2 Admin Read & Write (R2 Data Catalog + R2 storage).
set -euo pipefail

BUCKET=road-conditions-logs
NAMESPACE=ingest_worker
TABLE=cycle_logs_v2
STREAM=ingest_worker_logs
SINK=ingest_worker_logs_sink
PIPELINE=ingest_worker_logs_pipeline
ROLL_INTERVAL=21600 # 6h

: "${CF_CATALOG_TOKEN:?set CF_CATALOG_TOKEN to an R2 Admin Read & Write API token}"

# The stream (and the ingest-worker's LOG_STREAM binding) is left untouched.
npx wrangler pipelines delete "$PIPELINE"
npx wrangler pipelines sinks delete "$SINK"

npx wrangler pipelines sinks create "$SINK" \
  --type r2-data-catalog \
  --bucket "$BUCKET" \
  --namespace "$NAMESPACE" \
  --table "$TABLE" \
  --catalog-token "$CF_CATALOG_TOKEN" \
  --compression zstd \
  --roll-interval "$ROLL_INTERVAL"

npx wrangler pipelines create "$PIPELINE" \
  --sql "INSERT INTO ${SINK} SELECT * FROM ${STREAM}"

npx wrangler pipelines sinks get "$SINK"
echo "Done. Next poll cycle (~3 min) resumes writes; first file rolls within ${ROLL_INTERVAL}s."
