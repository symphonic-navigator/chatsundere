#!/usr/bin/env bash
# Local dev environment bootstrap for Chatsundere.
#
# Idempotent: re-run safely. Existing .env files are left alone.
# To reset: delete the relevant .env files and re-run.
set -euo pipefail
cd "$(dirname "$0")/.."

apps=(auth-service sync-service proxy-service user-client admin-client)

# auth-service ships its secret placeholders empty in .env.example (they must
# never be committed). These keys are validated with minLength(40), so a plain
# copy leaves the service unbootable until they are filled. Generate a 32-byte
# base64url value per key — that is exactly the shape auth-service expects for
# both the Ed25519 seed and the HMAC keys. Dev-only secrets; regenerate freely.
gen_secret() {
  openssl rand -base64 32 | tr '+/' '-_' | tr -d '='
}

# Fill any empty `KEY=` assignment for the given keys in the given file, in
# place. Non-empty values are left untouched, so this stays idempotent and also
# repairs a .env left half-filled by an earlier run of this script.
fill_empty_secrets() {
  local file="$1"
  shift
  for key in "$@"; do
    if grep -qE "^${key}=$" "$file"; then
      local value
      value="$(gen_secret)"
      sed -i "s|^${key}=$|${key}=${value}|" "$file"
      echo "  ↳ generated ${key}"
    fi
  done
}

for app in "${apps[@]}"; do
  example="apps/${app}/.env.example"
  env_file="apps/${app}/.env"
  if [[ ! -f "$example" ]]; then
    echo "✗ ${example} not found — is this the project root?" >&2
    exit 1
  fi
  if [[ -f "$env_file" ]]; then
    echo "✓ ${env_file} exists — leaving it alone."
  else
    cp "$example" "$env_file"
    echo "✓ Created ${env_file}"
  fi
  # Always top up empty secrets, whether the file is fresh or pre-existing.
  if [[ "$app" == "auth-service" ]]; then
    fill_empty_secrets "$env_file" \
      AUTH_JWT_PRIVATE_KEY \
      INVITATION_HMAC_KEY \
      REFRESH_TOKEN_HMAC_KEY \
      HMAC_KEY_PENDING_CODES \
      DECOY_WRAP_KEY
  fi
done

mkdir -p infra/data
echo "✓ Ensured infra/data/ exists (Docker creates per-service subdirs)"

echo ""
echo "=== Dev setup complete ==="
echo ""
echo "Next steps:"
echo "  1. direnv allow                                # if direnv is installed"
echo "  2. docker compose -f infra/compose.dev.yml up -d"
echo "  3. pnpm install                                # if not already done"
echo "  4. pnpm dev                                    # starts all services + clients"
