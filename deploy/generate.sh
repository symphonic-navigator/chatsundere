#!/usr/bin/env bash
# Script A — local generator. Depends only on: bash, openssl.
# Prompts for domain + options, mints all random secrets, renders the compose.
# OPAQUE_SERVER_SETUP and the MinIO scoped key are filled later by install.sh.
set -euo pipefail
cd "$(dirname "$0")"

# openssl-only base64url (no GNU coreutils `basenc`, which stock macOS lacks):
# standard base64, then remap the URL-unsafe chars and drop padding.
b64url32() { openssl rand 32 | openssl base64 -A | tr '+/' '-_' | tr -d '='; }
pw() { openssl rand -base64 24 | tr -d '/+='; }

echo "Chatsundere deployment generator"
read -rp "Base domain (e.g. chatsundere.me): " BASE_DOMAIN
read -rp "Instance name (unique per stack on this host) [chatsundere]: " INSTANCE_NAME
INSTANCE_NAME=${INSTANCE_NAME:-chatsundere}
read -rp "Traefik external network name [traefik]: " TRAEFIK_NETWORK
TRAEFIK_NETWORK=${TRAEFIK_NETWORK:-traefik}
read -rp "Traefik cert resolver name [letsencrypt]: " TRAEFIK_CERTRESOLVER
TRAEFIK_CERTRESOLVER=${TRAEFIK_CERTRESOLVER:-letsencrypt}
read -rp "Include Prometheus + Grafana monitoring? [y/N]: " MON
read -rp "Include a scoped Watchtower for auto-updates? [Y/n]: " WT

HOST_APP="app.$BASE_DOMAIN"
HOST_AUTH="auth.$BASE_DOMAIN"
HOST_SYNC="sync.$BASE_DOMAIN"
HOST_PROXY="proxy.$BASE_DOMAIN"
HOST_PROMETHEUS="prometheus.$BASE_DOMAIN"
HOST_GRAFANA="grafana.$BASE_DOMAIN"

# Advanced per-host override (optional).
read -rp "Override individual hostnames? [y/N]: " OVR
if [[ "$OVR" =~ ^[Yy] ]]; then
  read -rp "  app    host [$HOST_APP]: " x;   HOST_APP=${x:-$HOST_APP}
  read -rp "  auth   host [$HOST_AUTH]: " x;  HOST_AUTH=${x:-$HOST_AUTH}
  read -rp "  sync   host [$HOST_SYNC]: " x;  HOST_SYNC=${x:-$HOST_SYNC}
  read -rp "  proxy  host [$HOST_PROXY]: " x; HOST_PROXY=${x:-$HOST_PROXY}
fi

mkdir -p out out/postgres-init
cp postgres-init/01-create-databases.sh out/postgres-init/

# --- compute every filled value up front (associative array) ---
MON_PW=$(pw)
# Verified empirically (Docker Compose 5.3.1): `docker compose --env-file`
# interpolates $VAR references found WITHIN the env file's own values, even
# when that key is unused in the compose file — an apr1 hash's literal `$`
# segments (e.g. $apr1$salt$hash) get treated as unset-variable references
# and silently blanked at runtime. Doubling the `$` here (not just inside
# compose files) is required for the hash to survive the env-file load.
APR1_HASH=$(openssl passwd -apr1 "$MON_PW")
declare -A V=(
  [INSTANCE_NAME]="$INSTANCE_NAME"
  [BASE_DOMAIN]="$BASE_DOMAIN"
  [HOST_APP]="$HOST_APP" [HOST_AUTH]="$HOST_AUTH"
  [HOST_SYNC]="$HOST_SYNC" [HOST_PROXY]="$HOST_PROXY"
  [HOST_PROMETHEUS]="$HOST_PROMETHEUS" [HOST_GRAFANA]="$HOST_GRAFANA"
  [TRAEFIK_NETWORK]="$TRAEFIK_NETWORK" [TRAEFIK_CERTRESOLVER]="$TRAEFIK_CERTRESOLVER"
  [API_BASE_URL]="https://$HOST_AUTH/auth"
  [PROXY_PUBLIC_URL]="https://$HOST_PROXY" [SYNC_PUBLIC_URL]="https://$HOST_SYNC"
  [ADMIN_PUBLIC_URL]="https://$HOST_APP/admin/" [CORS_ALLOWED_ORIGINS]="https://$HOST_APP"
  [POSTGRES_PASSWORD]="$(pw)"
  [MINIO_ROOT_USER]="chatsundere-$(openssl rand -hex 4)" [MINIO_ROOT_PASSWORD]="$(pw)"
  [GRAFANA_ADMIN_PASSWORD]="$(pw)"
  # openssl passwd -apr1 emits only the hash; Traefik basicauth wants user:hash.
  [TRAEFIK_AUTH_USERS]="admin:${APR1_HASH//\$/\$\$}"
  [AUTH_JWT_PRIVATE_KEY]="$(b64url32)" [INVITATION_HMAC_KEY]="$(b64url32)"
  [REFRESH_TOKEN_HMAC_KEY]="$(b64url32)" [HMAC_KEY_PENDING_CODES]="$(b64url32)"
)

# --- render deployment.env from the template, replacing only known keys ---
: > out/deployment.env
while IFS= read -r line || [ -n "$line" ]; do
  key=${line%%=*}
  if [[ "$line" == *=* ]] && [[ -n "${V[$key]+x}" ]]; then
    printf '%s=%s\n' "$key" "${V[$key]}" >> out/deployment.env
  else
    printf '%s\n' "$line" >> out/deployment.env
  fi
done < deployment.env.template

# --- render the compose, trimming optional blocks ---
# Marker lines are always dropped; skip/skipw gate the lines *between* them.
# Defaults fall out of the regexes: an empty MON answer doesn't match ^[Yy]
# (monitoring skipped, matching the "[y/N]" prompt default), and an empty WT
# answer doesn't match ^[Nn] (watchtower kept, matching the "[Y/n]" default).
awk -v mon="$MON" -v wt="$WT" '
  /# >>> MONITORING/ { skip = (mon !~ /^[Yy]/); next }
  /# <<< MONITORING/ { skip = 0; next }
  /# >>> WATCHTOWER/ { skipw = (wt ~ /^[Nn]/); next }
  /# <<< WATCHTOWER/ { skipw = 0; next }
  { if (!skip && !skipw) print }
' compose.template.yml > out/docker-compose.yml

if [[ "$MON" =~ ^[Yy] ]]; then
  mkdir -p out/prometheus
  # Prod-correct scrape config: containers on the internal `chatsundere`
  # network, not the dev host-networking targets in infra/prometheus/prometheus.yml
  # (host.docker.internal doesn't resolve on a Linux VPS bridge). auth serves
  # /metrics on its single app port; sync/proxy split it onto their OPS port.
  cat > out/prometheus/prometheus.yml <<'EOF'
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: chatsundere
    static_configs:
      - targets: ['auth:3100', 'sync:9091', 'proxy:9090']
EOF
fi

chmod 600 out/deployment.env
echo
echo "Generated out/:"
ls -1 out
echo
echo "Monitoring password (user 'admin'): $MON_PW"
echo
echo "Next:"
echo "  1. BACK UP out/deployment.env after install.sh runs — it will hold"
echo "     irreplaceable OPAQUE + HMAC/JWT secrets."
echo "  2. scp -r out/ user@your-vps:/opt/chatsundere"
echo "  3. ssh user@your-vps 'cd /opt/chatsundere && ./install.sh'"
cp install.sh out/install.sh 2>/dev/null || true
chmod +x out/install.sh 2>/dev/null || true
