#!/usr/bin/env bash
# Create the very first primary_admin for a local dev instance.
#
# Runs the auth-service bootstrap CLI with the dev env loaded, then surfaces the
# one-time join URL you paste into the user-client (:3000) to register. Once you
# finish registration there, that account IS the primary_admin and can sign in
# to the admin-client at http://localhost:5174/admin/.
#
# Refuses to run once a primary_admin exists (the CLI enforces this) — reset the
# auth database if you need to bootstrap again.
set -euo pipefail
cd "$(dirname "$0")/apps/auth-service"

if [[ ! -f .env.dev ]]; then
  echo "✗ apps/auth-service/.env.dev not found — run scripts/setup-dev.sh first." >&2
  exit 1
fi

# The CLI prints the path to a 0600 JSON file (code, qr_url, …) on its first
# stdout line. A command substitution propagates a non-zero exit (e.g. a
# primary_admin already exists), and the CLI's stderr message passes straight
# through to the operator.
out="$(bun --env-file=.env.dev src/cli/bootstrap.ts)"
file="$(printf '%s\n' "$out" | head -1)"
qr_url="$(bun -e "console.log(JSON.parse(await Bun.file(process.argv[1]).text()).qr_url)" "$file")"

echo
echo "▸ First-owner invitation created. Paste this into the user-client (http://localhost:3000):"
echo
echo "    $qr_url"
echo
echo "  Register there, then sign in to the admin-client at http://localhost:5174/admin/"
echo "  (full details, valid 24h: $file)"
