#!/usr/bin/env bash
# Local dev environment bootstrap for Chatsundere.
#
# Idempotent: re-run safely. Existing .env files are left alone.
# To reset: delete the relevant .env files and re-run.
set -euo pipefail
cd "$(dirname "$0")/.."

apps=(auth-service sync-service proxy-service user-client admin-client)

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
