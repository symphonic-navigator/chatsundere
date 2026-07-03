#!/usr/bin/env bash
# Bring up the local development infrastructure and make it ready for the backend
# services: start the containers, wait for Postgres, ensure the per-service
# databases exist, then run the auth + sync migrations.
#
# Idempotent — safe to run repeatedly. Use this when you want to run the backend
# services yourself (in Rider / separate terminals); use ./dev.sh to run
# everything (infra + services + client) in one command.
set -euo pipefail
cd "$(dirname "$0")"

COMPOSE=(docker compose -f infra/compose.dev.yml)

echo "▸ Starting dev infrastructure (postgres · redis · minio · prometheus · grafana)…"
"${COMPOSE[@]}" up -d

echo "▸ Waiting for Postgres to accept connections…"
for _ in $(seq 1 60); do
  if "${COMPOSE[@]}" exec -T postgres pg_isready -U chatsundere -d postgres >/dev/null 2>&1; then
    break
  fi
  sleep 1
done
if ! "${COMPOSE[@]}" exec -T postgres pg_isready -U chatsundere -d postgres >/dev/null 2>&1; then
  echo "✗ Postgres did not become ready in time." >&2
  exit 1
fi

# The init scripts only run on a fresh data volume, so an existing dev machine
# needs these ensured explicitly. Idempotent. Beyond the two app databases we
# also create the test databases the test harnesses default to, so `pnpm test`
# is green out of the box: auth's setup.ts defaults DATABASE_URL to auth_test_db
# (integration tests skip when TEST_DATABASE_URL is unset), sync's to
# sync_db_test; auth_db_test is the dedicated DB a full auth integration run
# points TEST_DATABASE_URL at.
echo "▸ Ensuring databases exist…"
for db in auth_db auth_test_db auth_db_test sync_db sync_db_test; do
  exists=$("${COMPOSE[@]}" exec -T postgres \
    psql -tAc "SELECT 1 FROM pg_database WHERE datname = '${db}'" -U chatsundere -d postgres)
  if [ "${exists}" != "1" ]; then
    "${COMPOSE[@]}" exec -T postgres createdb -U chatsundere -O chatsundere "${db}"
    echo "  created ${db}"
  fi
done

echo "▸ Running migrations (app + test databases)…"
for db in auth_db auth_test_db auth_db_test; do
  ( cd apps/auth-service && DATABASE_URL="postgres://chatsundere:dev@localhost:5432/${db}" bun src/db/migrations.ts >/dev/null )
done
for db in sync_db sync_db_test; do
  ( cd apps/sync-service && DATABASE_URL="postgres://chatsundere:dev@localhost:5432/${db}" bun src/db/migrations.ts >/dev/null )
done

echo "✓ Infrastructure ready."
echo "  Postgres :5432 · Redis :6379 · MinIO :9000 · Prometheus :9090 · Grafana :3001 (admin/admin)"
