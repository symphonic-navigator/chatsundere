#!/usr/bin/env bash
# Reset the local dev backend to a clean slate.
#
# Truncates every auth-service table so ./bootstrap-admin.sh can mint a fresh
# primary_admin, AND wipes the sync-service store (sync_db + the MinIO blob
# bucket). Use after an incompatible schema or crypto change leaves the existing
# account unusable (e.g. an OPAQUE-identity convention change bakes a now-stale
# identifier into the credential record).
#
# The sync wipe matters: auth_db and sync_db are SEPARATE databases, and a fresh
# bootstrap mints a brand-new random accountId. Clearing only auth_db therefore
# stranded every previous account's records and blobs in sync_db as undeletable
# orphans (found live 2026-07-06: three orphan accounts, ~2.6k records, 24 MB of
# MinIO objects). A full reset must clear BOTH sides.
#
# Dev only — it targets the Docker-Compose Postgres and MinIO on localhost.
# Never point it at a real database.
#
# This clears the SERVER side only. The client keeps its account in the
# browser's IndexedDB, so after running this also clear site data for the
# user-client (http://localhost:3000) and the admin-client
# (http://localhost:5174) — DevTools → Application → Storage → Clear site data —
# or login will still find the stale local account.
set -euo pipefail
cd "$(dirname "$0")"

COMPOSE="infra/compose.dev.yml"

if ! docker compose -f "$COMPOSE" ps postgres >/dev/null 2>&1; then
  echo "✗ Postgres container not found. Is the dev stack up? (./dev-infra.sh)" >&2
  exit 1
fi

echo "▸ Resetting auth_db (truncating all auth-service tables)…"
docker compose -f "$COMPOSE" exec -T postgres \
  psql -U chatsundere -d auth_db -v ON_ERROR_STOP=1 <<'SQL'
TRUNCATE TABLE
  audit_log,
  refresh_tokens,
  auth_methods,
  pending_codes,
  users
RESTART IDENTITY CASCADE;
SQL

echo "✓ auth_db cleared."

echo "▸ Resetting sync_db (records, blobs, accounts) and re-minting the epoch…"
docker compose -f "$COMPOSE" exec -T postgres \
  psql -U chatsundere -d sync_db -v ON_ERROR_STOP=1 <<'SQL'
TRUNCATE TABLE
  sync_records,
  sync_blobs,
  sync_accounts
RESTART IDENTITY CASCADE;
-- Re-mint the instance epoch so any client still holding an old watermark does a
-- clean re-sync against the wiped store (mirrors reEpoch(), db/epoch.ts). The
-- __drizzle_migrations table is deliberately left intact.
DELETE FROM sync_meta;
INSERT INTO sync_meta DEFAULT VALUES;
SQL

echo "✓ sync_db cleared and re-epoched."

# Empty the MinIO blob bucket. The bucket is auto-created by the sync-service at
# boot, so removing every object is enough; the bucket itself may stay.
if docker compose -f "$COMPOSE" ps minio >/dev/null 2>&1; then
  echo "▸ Emptying the MinIO blob bucket (chatsundere-blobs)…"
  docker compose -f "$COMPOSE" exec -T minio sh -c '
    mc alias set local http://localhost:9000 chatsundere-dev chatsundere-dev-secret >/dev/null 2>&1
    mc rm --recursive --force local/chatsundere-blobs/ >/dev/null 2>&1 || true
  '
  echo "✓ MinIO bucket emptied."
else
  echo "⚠ MinIO container not found — skipping blob wipe (blobs may linger)." >&2
fi

echo
echo "  Next:"
echo "    1. Clear site data for http://localhost:3000 and http://localhost:5174"
echo "       (DevTools → Application → Storage → Clear site data)."
echo "    2. ./bootstrap-admin.sh   → then register fresh in the user-client."
