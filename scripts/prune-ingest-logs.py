#!/usr/bin/env python3
"""Delete cycle-log rows older than RETENTION_DAYS from the R2 Data Catalog table.

The ingest-worker streams one row per poll cycle into ingest_worker.cycle_logs (an Iceberg
table in the road-conditions-logs bucket) and never removes any. admin-trends only queries the
last 30 days, so anything past ~90 is dead weight. R2 SQL is read-only, so the delete goes
through an Iceberg client; snapshot expiration (enabled on the bucket, 7d) reclaims the freed
storage on its own afterwards.

Run manually every few months, or on a schedule via .github/workflows/prune-ingest-logs.yml.

    CF_ACCOUNT_ID=... R2_CATALOG_TOKEN=... python scripts/prune-ingest-logs.py

Env:
  CF_ACCOUNT_ID      Cloudflare account id
  R2_CATALOG_TOKEN   API token with R2 Data Catalog + R2 storage *write* (Admin Read & Write)
  RETENTION_DAYS     optional, default 90
"""

import os
from datetime import datetime, timedelta, timezone

from pyiceberg.catalog.rest import RestCatalog
from pyiceberg.expressions import LessThan

ACCOUNT_ID = os.environ["CF_ACCOUNT_ID"]
TOKEN = os.environ["R2_CATALOG_TOKEN"]
RETENTION_DAYS = int(os.environ.get("RETENTION_DAYS", "90"))
TABLE = "ingest_worker.cycle_logs_v2"  # keep in sync with LOG_TABLE in api-worker/src/routes/admin-trends.ts

# ts is an Iceberg `timestamp` (tz-naive UTC) — a naive ISO string is what its literal parser
# expects.
cutoff = (datetime.now(timezone.utc) - timedelta(days=RETENTION_DAYS)).replace(tzinfo=None)

catalog = RestCatalog(
    name="r2",
    uri=f"https://catalog.cloudflarestorage.com/{ACCOUNT_ID}/road-conditions-logs",
    warehouse=f"{ACCOUNT_ID}_road-conditions-logs",
    token=TOKEN,
)

table = catalog.load_table(TABLE)
table.delete(LessThan("ts", cutoff))
print(f"{TABLE}: deleted rows with ts < {cutoff.isoformat()} (retention {RETENTION_DAYS}d)")
