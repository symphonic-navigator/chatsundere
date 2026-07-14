#!/usr/bin/env bash
# Verify that every environment variable a service declares in its .env.example
# is actually passed to that service in compose.template.yml.
#
# Why this exists: on 2026-07-14 the alpha go-live shipped with APP_PUBLIC_URL
# declared in apps/auth-service/.env.example, minted by generate.sh into
# deployment.env, and documented in DEPLOYMENT.md — but never passed into the
# container. env.APP_PUBLIC_URL was therefore always undefined in production,
# buildJoinQrUrl silently fell back to its legacy auth-origin form, and every
# QR-driven pairing 404'd. The code was correct; the value never arrived. Both
# halves looked right in isolation, so every review passed. This check is the
# thing that looks across the seam.
#
# The contract is the .env.example files — DEPLOYMENT.md §4 already declares
# them the source of truth. Values are not checked, only that the key reaches
# the service: a key set to a literal in compose (NODE_ENV, PORT) counts.
#
# Exit 0 = wired. Exit 1 = a declared variable never reaches its service.
set -euo pipefail
cd "$(dirname "$0")"

COMPOSE=compose.template.yml

# service-dir:compose-service-name
SERVICES=(
  "auth-service:auth"
  "sync-service:sync"
  "proxy-service:proxy"
)

# Variables a service declares but production must NOT receive. Each needs a
# reason: silence here is how the APP_PUBLIC_URL gap would have hidden.
is_excluded() {
  case "$1" in
    # Test-harness only; the prod stack has no test database.
    TEST_DATABASE_URL) return 0 ;;
    # Dev escape hatch. Passing it in production would let auth boot with an
    # ephemeral OPAQUE setup, silently bricking every account on restart.
    ALLOW_EPHEMERAL_OPAQUE_SETUP) return 0 ;;
    *) return 1 ;;
  esac
}

# Keys inside one service's `environment:` block. Relies on compose's fixed
# indentation: services at 2 spaces, their keys at 4, environment entries at 6.
env_keys_for() {
  awk -v want="$1" '
    /^  [a-z0-9_-]+:[[:space:]]*$/ { svc = $1; sub(/:$/, "", svc); inenv = 0; next }
    svc == want && /^    environment:[[:space:]]*$/ { inenv = 1; next }
    svc == want && inenv && /^    [a-z]/ { inenv = 0 }
    svc == want && inenv && /^      [A-Z_]+:/ { key = $1; sub(/:$/, "", key); print key }
  ' "$COMPOSE"
}

declared_for() {
  grep -E '^[A-Z_]+=' "../apps/$1/.env.example" | cut -d= -f1
}

failed=0
for pair in "${SERVICES[@]}"; do
  dir=${pair%%:*}
  svc=${pair##*:}

  if [ ! -f "../apps/$dir/.env.example" ]; then
    echo "FAIL  apps/$dir/.env.example is missing — the contract this checks against"
    failed=1
    continue
  fi

  wired=$(env_keys_for "$svc")
  if [ -z "$wired" ]; then
    echo "FAIL  $svc: no environment block found in $COMPOSE (renamed service?)"
    failed=1
    continue
  fi

  missing=()
  while IFS= read -r key; do
    is_excluded "$key" && continue
    grep -qx "$key" <<<"$wired" || missing+=("$key")
  done < <(declared_for "$dir")

  if [ ${#missing[@]} -eq 0 ]; then
    echo "ok    $svc: every declared variable reaches the container"
  else
    failed=1
    for key in "${missing[@]}"; do
      echo "FAIL  $svc: $key is declared in apps/$dir/.env.example but never passed in $COMPOSE"
    done
    echo "      Add each to the $svc service's environment block as 'KEY: \${KEY}',"
    echo "      or, if production must not receive it, exclude it in is_excluded()"
    echo "      in this script — with a reason."
  fi
done

exit "$failed"
