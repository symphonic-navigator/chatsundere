# Deploying Chatsundere

A two-phase, secret-generating installer for the full stack behind an existing
Traefik. Full operator reference: `../obsidian/DEPLOYMENT.md`.

## Prerequisites

- A host with Docker + Docker Compose and an **existing Traefik** on an external
  docker network (default name `traefik`), terminating TLS on `websecure`.
- DNS A/AAAA records for `app.`, `auth.`, `sync.`, `proxy.` (and, if you enable
  monitoring, `prometheus.`, `grafana.`) under your base domain, pointing at the
  host.
- Locally: `bash` ≥ 4 + `openssl`. Stock macOS `/bin/bash` is 3.2 (Apple ships an
  ancient GPLv2-frozen build) — `generate.sh` relies on bash-4 associative
  arrays, so macOS operators need Homebrew bash (`brew install bash`, then run
  the script with `/opt/homebrew/bin/bash generate.sh` or put it first on `PATH`).
  No GNU coreutils required — the script's secret generation is openssl-only, so
  macOS's built-in LibreSSL `openssl` is enough.

## 1. Generate (local)

```bash
cd deploy
./generate.sh          # answers: base domain, instance name, Traefik network, monitoring y/N
```

This writes `out/` with `deployment.env` (random secrets filled),
`docker-compose.yml`, `postgres-init/`, and `install.sh`.

**Running multiple instances on one host?** Give each stack a distinct
`INSTANCE_NAME` (default `chatsundere`) and distinct hostnames — everything
else (compose project, Traefik router/service/middleware names, the internal
network, the Watchtower scope) namespaces off it automatically, so stacks
sharing a host/Traefik never collide. See `../obsidian/DEPLOYMENT.md` §5.

## 2. Ship + install (server)

```bash
scp -r out/ user@your-vps:/opt/chatsundere
ssh user@your-vps 'cd /opt/chatsundere && ./install.sh'
```

`install.sh` brings up Postgres/Redis/MinIO, creates the MinIO bucket + a
bucket-scoped access key, generates the OPAQUE server setup **once**, starts the
services (auth and sync self-migrate on every boot before serving, so upgrades
need no manual migration step), and bootstraps your first admin.

## 3. After first boot

- **Back up `deployment.env`** — it now holds `OPAQUE_SERVER_SETUP` and the
  HMAC/JWT keys. Losing them is unrecoverable; rotating OPAQUE bricks every
  account's passphrase auth.
- Point a client at `https://app.<your-domain>`; the admin console is at
  `https://app.<your-domain>/admin/`.

See `../obsidian/DEPLOYMENT.md` for operations, backups/restore (the epoch-flip
runbook), scaling honesty, and the security checklist.
