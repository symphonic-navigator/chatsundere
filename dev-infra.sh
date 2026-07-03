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
# whose volume predates sync_db needs these ensured explicitly. Idempotent.
echo "▸ Ensuring databases exist (auth_db, auth_db_test, sync_db, sync_db_test)…"
for db in auth_db auth_db_test sync_db sync_db_test; do
  exists=$("${COMPOSE[@]}" exec -T postgres \
    psql -tAc "SELECT 1 FROM pg_database WHERE datname = '${db}'" -U chatsundere -d postgres)
  if [ "${exists}" != "1" ]; then
    "${COMPOSE[@]}" exec -T postgres createdb -U chatsundere -O chatsundere "${db}"
    echo "  created ${db}"
  fi
done

echo "▸ Running migrations (auth-service, sync-service)…"
( cd apps/auth-service && bun --env-file=.env.dev src/db/migrations.ts )
( cd apps/sync-service && bun --env-file=.env.dev src/db/migrations.ts )

echo "✓ Infrastructure ready."
echo "  Postgres :5432 · Redis :6379 · MinIO :9000 · Prometheus :9090 · Grafana :3001 (admin/admin)"
