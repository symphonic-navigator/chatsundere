#!/usr/bin/env bash
# Tear down the local development infrastructure containers.
#
#   ./dev-down.sh          Stop the containers, PRESERVE all data (databases,
#                          MinIO objects, Prometheus/Grafana state).
#   ./dev-down.sh --wipe   Stop AND delete every volume + bind-mount, so the next
#                          ./dev-infra.sh re-creates fresh databases and buckets.
#
# Backend services started by ./dev.sh are children of that process and stop on
# its Ctrl-C — this script only touches the containers.
set -euo pipefail
cd "$(dirname "$0")"

COMPOSE=(docker compose -f infra/compose.dev.yml)

if [ "${1:-}" = "--wipe" ]; then
  echo "▸ Stopping infrastructure and WIPING all data (volumes + bind-mounts)…"
  "${COMPOSE[@]}" down -v
  rm -rf infra/data
  echo "✓ Down + wiped. The next ./dev-infra.sh starts from a clean slate."
else
  echo "▸ Stopping infrastructure (data preserved)…"
  "${COMPOSE[@]}" down
  echo "✓ Down. Data preserved — ./dev-infra.sh brings it straight back."
fi
