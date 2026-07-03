#!/usr/bin/env bash
# Run the ENTIRE local stack in one command: infrastructure (containers) plus the
# three backend services and the user-client, all with hot reload. Ctrl-C stops
# every service and leaves the infra containers running (tear those down with
# ./dev-down.sh).
#
# Services run on the host via bun --watch (fast iteration) — only the supporting
# infrastructure runs in Docker.
set -euo pipefail
cd "$(dirname "$0")"

# 1. Infrastructure + migrations.
./dev-infra.sh

# 2. Backend services + client, each in the background, torn down together.
echo
echo "▸ Starting backend services + user-client (hot reload). Ctrl-C stops all."
pids=()
cleanup() {
  echo
  echo "▸ Stopping services…"
  for pid in "${pids[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
  echo "✓ Services stopped. Infra still up — run ./dev-down.sh to tear it down."
}
trap cleanup INT TERM

( cd apps/auth-service  && exec bun --env-file=.env.dev --watch src/index.ts ) & pids+=("$!")
( cd apps/sync-service  && exec bun --env-file=.env.dev --watch src/index.ts ) & pids+=("$!")
( cd apps/proxy-service && exec bun --env-file=.env.dev --watch src/index.ts ) & pids+=("$!")
( cd apps/user-client   && exec pnpm dev )                                      & pids+=("$!")

echo "✓ auth :3100 · sync :3200 (ops :3201) · proxy :8090 (ops :3300) · client :3000"
echo "  Link the client to the backend at http://localhost:3100 (server-linking)."
wait
