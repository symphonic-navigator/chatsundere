#!/usr/bin/env bash
# Script B — server installer. Idempotent: safe to re-run. Fills the
# generate-once secrets (OPAQUE, MinIO scoped key) only when still empty.
set -euo pipefail
cd "$(dirname "$0")"

ENV_FILE=deployment.env
# An array, not a string: the compose command's words are each meaningful and
# none may be re-split/re-quoted by accident — an array sidesteps the whole
# unquoted-expansion class of bug. (Project name is `name: ${INSTANCE_NAME}`,
# see below.)
COMPOSE=(docker compose --env-file "$ENV_FILE" -f docker-compose.yml)
BACKEND_IMAGE=ghcr.io/symphonic-navigator/chatsundere-backend:latest

need() { command -v "$1" >/dev/null || { echo "Missing: $1"; exit 1; }; }
need docker
get() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2-; }
# The rendered docker-compose.yml pins `name: ${INSTANCE_NAME}` at the top
# level, which fixes the Compose project name regardless of the directory
# install.sh runs from (top-level `name:` outranks directory-basename in
# Compose's project-name precedence). That makes the internal `chatsundere`
# network's real name deterministic: `<project>_<network-key>` =
# `<INSTANCE_NAME>_chatsundere`. Verified empirically against a generated
# out/docker-compose.yml with `docker compose ... config` — do not derive
# this from $PWD.
CHATSUNDERE_NETWORK="$(get INSTANCE_NAME)_chatsundere"
set_kv() { # set_kv KEY VALUE — replace the line in-place
  local k=$1 v=$2
  if grep -qE "^$k=" "$ENV_FILE"; then
    awk -v k="$k" -v v="$v" 'BEGIN{FS=OFS="="} $1==k{$0=k"="v} {print}' "$ENV_FILE" > "$ENV_FILE.tmp"
    mv "$ENV_FILE.tmp" "$ENV_FILE"
  else
    echo "$k=$v" >> "$ENV_FILE"
  fi
  chmod 600 "$ENV_FILE"
}

TRAEFIK_NETWORK=$(get TRAEFIK_NETWORK)
echo "== Preflight =="
"${COMPOSE[@]}" config >/dev/null && echo "compose OK"
if ! docker network inspect "$TRAEFIK_NETWORK" >/dev/null 2>&1; then
  echo "Traefik network '$TRAEFIK_NETWORK' not found."
  echo "Create it (docker network create $TRAEFIK_NETWORK) or point TRAEFIK_NETWORK at your existing one."
  exit 1
fi

echo "== Bring up data services =="
"${COMPOSE[@]}" up -d postgres redis minio
for s in postgres redis minio; do
  echo -n "waiting for $s "
  tries=0
  until [ "$("${COMPOSE[@]}" ps -q "$s" | xargs -r docker inspect -f '{{.State.Health.Status}}')" = healthy ]; do
    tries=$((tries + 1))
    if [ "$tries" -ge 60 ]; then
      echo " TIMED OUT waiting for $s to become healthy"
      "${COMPOSE[@]}" logs --tail=50 "$s"
      exit 1
    fi
    echo -n .; sleep 2
  done; echo " healthy"
done

echo "== MinIO bucket + scoped key =="
if [ "$(get S3_ACCESS_KEY_ID)" = "CHANGE-ME-ON-SERVER" ]; then
  ROOT_U=$(get MINIO_ROOT_USER); ROOT_P=$(get MINIO_ROOT_PASSWORD)
  BUCKET=$(get S3_BUCKET)
  POLICY='{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["s3:*"],"Resource":["arn:aws:s3:::'"$BUCKET"'","arn:aws:s3:::'"$BUCKET"'/*"]}]}'
  # Credentials travel via -e, the mc script via stdin (a quoted heredoc, so
  # $VARS stay literal for the container's own shell to expand) — verified
  # live against infra/compose.dev.yml's minio. This avoids the brittle
  # break-out-of-single-quotes splicing an earlier draft used, which risked
  # mangling on any future credential containing a quote character.
  OUT=$(docker run --rm -i --network "$CHATSUNDERE_NETWORK" \
    -e ROOT_U="$ROOT_U" -e ROOT_P="$ROOT_P" -e BUCKET="$BUCKET" -e POLICY="$POLICY" \
    --entrypoint sh minio/mc -s <<'EOF'
set -e
mc alias set m http://minio:9000 "$ROOT_U" "$ROOT_P" >/dev/null
mc mb --ignore-existing "m/$BUCKET" >/dev/null
# Live-verified: the pinned mc build has no `mc version disable` — the real
# subcommand is `suspend` (`mc version --help`: enable|suspend|info). New
# buckets are unversioned by default, so this is belt-and-braces.
mc version suspend "m/$BUCKET" >/dev/null 2>&1 || true
printf '%s' "$POLICY" > /tmp/p.json
mc admin user svcacct add --json --policy /tmp/p.json m "$ROOT_U"
EOF
  )
  AK=$(printf '%s' "$OUT" | grep -oE '"accessKey"[^,]*' | cut -d'"' -f4)
  SK=$(printf '%s' "$OUT" | grep -oE '"secretKey"[^,]*' | cut -d'"' -f4)
  [ -n "$AK" ] && [ -n "$SK" ] || { echo "mc svcacct add failed:"; echo "$OUT"; exit 1; }
  set_kv S3_ACCESS_KEY_ID "$AK"; set_kv S3_SECRET_ACCESS_KEY "$SK"
  echo "scoped key created"
else
  echo "scoped key already present — skipping"
fi

echo "== OPAQUE server setup (generate once) =="
if [ "$(get OPAQUE_SERVER_SETUP)" = "CHANGE-ME-ON-SERVER" ]; then
  SETUP=$(docker run --rm "$BACKEND_IMAGE" bun run --cwd apps/auth-service generate-opaque-setup | tr -d '\r\n')
  [ -n "$SETUP" ] || { echo "OPAQUE generation produced no output"; exit 1; }
  set_kv OPAQUE_SERVER_SETUP "$SETUP"
  echo "OPAQUE_SERVER_SETUP generated — BACK UP deployment.env NOW; never rotate this value."
else
  echo "OPAQUE already set — skipping (rotating it would brick every account)"
fi

echo "== Bring up application services =="
# auth + sync migrate-then-serve via their compose command (idempotent), so no
# separate migration step is needed here; the /readyz wait below tolerates the
# one-off migrate delay on first boot. A bare `up -d` (no service names) already
# brings up every service the compose file defines, incl. monitoring/WUD
# when the generator rendered them in, so one call covers the whole stack.
"${COMPOSE[@]}" up -d

echo "== Wait for /readyz =="
for s in auth:3100 sync:9091 proxy:9090; do
  name=${s%%:*}; port=${s##*:}
  echo -n "waiting for $name "
  tries=0
  until "${COMPOSE[@]}" exec -T "$name" sh -c "wget -qO- http://localhost:$port/readyz >/dev/null 2>&1 || curl -fsS http://localhost:$port/readyz >/dev/null 2>&1"; do
    tries=$((tries + 1))
    if [ "$tries" -ge 60 ]; then
      echo " TIMED OUT waiting for $name to become ready"
      "${COMPOSE[@]}" logs --tail=50 "$name"
      exit 1
    fi
    echo -n .; sleep 2
  done; echo " ready"
done

echo "== Bootstrap the first admin =="
# bootstrap-admin (apps/auth-service/src/cli/bootstrap.ts) is NOT interactive —
# it takes no stdin. It refuses (exit 1, "refusing to run" on stderr) once a
# primary_admin/auth_methods row already exists, which is how re-running
# install.sh stays idempotent here; that refusal must not abort the script.
# On success it prints the in-container invitation-file path (and a follow-up
# line) to STDOUT, so we cat that file back out for the operator to see.
#
# `bun run` prints a `$ <command>` banner to STDERR before the script's own
# output runs, so stdout and stderr must be captured SEPARATELY — merging
# them (2>&1) risks `head -1` picking up the banner instead of the real path.
# --silent suppresses the banner outright; the split capture is belt-and-braces
# in case a future bun version prints it elsewhere.
BOOTSTRAP_STDERR_FILE=$(mktemp)
set +e
BOOTSTRAP_OUT=$("${COMPOSE[@]}" exec -T auth bun run --silent --cwd apps/auth-service bootstrap-admin 2>"$BOOTSTRAP_STDERR_FILE")
BOOTSTRAP_STATUS=$?
set -e
BOOTSTRAP_ERR=$(cat "$BOOTSTRAP_STDERR_FILE")
rm -f "$BOOTSTRAP_STDERR_FILE"
echo "$BOOTSTRAP_OUT"
if [ -n "$BOOTSTRAP_ERR" ]; then echo "$BOOTSTRAP_ERR" >&2; fi
if [ "$BOOTSTRAP_STATUS" -eq 0 ]; then
  BOOTSTRAP_FILE=$(printf '%s\n' "$BOOTSTRAP_OUT" | head -1)
  if [ -n "$BOOTSTRAP_FILE" ]; then
    echo
    echo "First invitation (redeem at https://$(get HOST_APP)/join):"
    # Guarded: a still-off capture must not abort the install on its last line.
    "${COMPOSE[@]}" exec -T auth cat "$BOOTSTRAP_FILE" || echo "(could not read invitation file back — check the path above manually)"
  fi
elif printf '%s' "$BOOTSTRAP_ERR" | grep -q "refusing to run"; then
  echo "admin already bootstrapped — skipping"
else
  echo "bootstrap-admin failed unexpectedly"
  exit 1
fi

echo
echo "Done. Public URLs:"
echo "  app:   https://$(get HOST_APP)   (admin at /admin/)"
echo "  auth:  https://$(get HOST_AUTH)   config: /api/v1/config"
echo "  sync:  https://$(get HOST_SYNC)"
echo "  proxy: https://$(get HOST_PROXY)"
