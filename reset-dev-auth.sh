#!/usr/bin/env bash
# Reset the local dev auth database to a clean slate.
#
# Truncates every auth-service table so ./bootstrap-admin.sh can mint a fresh
# primary_admin. Use after an incompatible schema or crypto change leaves the
# existing account unusable (e.g. an OPAQUE-identity convention change bakes a
# now-stale identifier into the credential record).
#
# Dev only — it targets the Docker-Compose Postgres on localhost. Never point
# it at a real database.
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
echo
echo "  Next:"
echo "    1. Clear site data for http://localhost:3000 and http://localhost:5174"
echo "       (DevTools → Application → Storage → Clear site data)."
echo "    2. ./bootstrap-admin.sh   → then register fresh in the user-client."
