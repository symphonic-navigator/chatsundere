#!/usr/bin/env bash
# SPDX-License-Identifier: AGPL-3.0-only
#
# Create a primary-admin bootstrap invitation and present it ready-to-use.
#
# Wraps `pnpm --filter @chatsundere/auth-service bootstrap-admin`, parses the
# drop file it writes into $XDG_RUNTIME_DIR, and prints a paste-ready URL plus
# an ASCII QR code (when `qrencode` is installed). With --copy the URL is also
# placed on the clipboard.
#
# Refuses (via the underlying CLI) when a primary admin already exists or any
# auth_methods rows are present. Run from the repo root.

set -euo pipefail

# ─── Flags ────────────────────────────────────────────────────────────────────
copy_to_clipboard=false
for arg in "$@"; do
  case "$arg" in
    --copy) copy_to_clipboard=true ;;
    -h|--help)
      cat <<'EOF'
Usage: scripts/create_primary_admin_invite.sh [--copy]

Generates a primary-admin bootstrap invitation and prints the link URL.
Pass --copy to additionally place the URL on the clipboard (wl-copy or xclip).
EOF
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      exit 64
      ;;
  esac
done

# ─── Prerequisites ────────────────────────────────────────────────────────────
need() {
  command -v "$1" >/dev/null 2>&1 || { echo "Missing required tool: $1" >&2; exit 69; }
}
need pnpm
need jq

# ─── Bootstrap the invitation ────────────────────────────────────────────────
echo "Generating bootstrap invitation…"
if ! cli_output=$(pnpm --filter @chatsundere/auth-service --silent bootstrap-admin 2>&1); then
  echo "$cli_output" >&2
  cat >&2 <<'EOF'

bootstrap-admin refused. Common causes:
  • A primary_admin already exists. Sign in instead, or wipe the DB first.
  • The auth_methods table is non-empty.
EOF
  exit 1
fi

# First line of stdout is the path to the drop file.
file_path=$(printf '%s\n' "$cli_output" | head -n1)
if [[ ! -r "$file_path" ]]; then
  echo "Could not read the bootstrap drop file: $file_path" >&2
  echo "Raw CLI output:" >&2
  echo "$cli_output" >&2
  exit 1
fi

# ─── Parse drop file ─────────────────────────────────────────────────────────
url=$(jq -r '.url' "$file_path")
expires_unix_ms=$(jq -r '.expires_at_unix_ms' "$file_path")
invitation_id=$(jq -r '.invitation_id' "$file_path")
expires_at=$(date -d "@$((expires_unix_ms / 1000))" '+%Y-%m-%d %H:%M:%S %Z' 2>/dev/null \
            || date -r "$((expires_unix_ms / 1000))" '+%Y-%m-%d %H:%M:%S %Z')

# ─── Output ──────────────────────────────────────────────────────────────────
printf '\n'
printf '  Invitation ID : %s\n' "$invitation_id"
printf '  Expires at    : %s\n' "$expires_at"
printf '  Drop file     : %s\n' "$file_path"
printf '\n'
printf '  URL (paste into the user-client at /linking/paste):\n\n'
printf '    %s\n\n' "$url"

if command -v qrencode >/dev/null 2>&1; then
  printf '  QR code:\n\n'
  qrencode -t ANSIUTF8 -m 2 "$url"
  printf '\n'
fi

if $copy_to_clipboard; then
  if command -v wl-copy >/dev/null 2>&1; then
    printf '%s' "$url" | wl-copy
    echo "  URL copied to clipboard (wl-copy)."
  elif command -v xclip >/dev/null 2>&1; then
    printf '%s' "$url" | xclip -selection clipboard
    echo "  URL copied to clipboard (xclip)."
  else
    echo "  --copy requested but neither wl-copy nor xclip is installed." >&2
  fi
fi
