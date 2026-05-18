# Chatsundere — Onboarding

Welcome. This is for anyone (human or Claude instance) joining Chatsundere work for the first time.

## Read first

1. `CLAUDE.md` (repository root) — operating rules.
2. `obsidian/briefs/` — Lyra's design briefs (start with `phase 0/project-setup.md`).
3. `obsidian/decisions/` — Architectural Decision Records.

## Prerequisites

- `git`
- `mise` (installs the exact bun / node / pnpm versions pinned in `.mise.toml`)
- `docker` with Compose v2
- `direnv` (optional but recommended)

## Setup

```bash
git clone <repository-url> chatsundere
cd chatsundere
mise install
pnpm install
./scripts/setup-dev.sh
direnv allow                          # optional, if direnv is installed
docker compose -f infra/compose.dev.yml up -d
pnpm dev
```

### One-time Linux + UFW exception

Backend services run natively on the host (`bun --watch`), while Prometheus runs in a container and needs to scrape `/metrics` on those host ports. If your distribution runs UFW (or any firewall that drops traffic from Docker bridges by default), Prometheus's scrape requests time out.

Allow the dev Docker bridge subnet to reach the three backend ports once:

```bash
sudo ufw allow from 172.28.0.0/24 to any port 3100:3300 proto tcp \
  comment 'Chatsundere dev: Prometheus scrape host backends'
```

The subnet `172.28.0.0/24` is pinned in `infra/compose.dev.yml` exactly so this UFW rule remains stable across `docker compose down/up` cycles. macOS and Windows users do not need this step — their Docker stacks route differently.

After `pnpm dev`:

- `http://localhost:3000` — user-client
- `http://localhost:3010` — admin-client
- `http://localhost:3100` — auth-service (`/healthz`, `/readyz`, `/metrics`)
- `http://localhost:3200` — sync-service
- `http://localhost:3300` — proxy-service
- `http://localhost:9090` — Prometheus
- `http://localhost:3001` — Grafana (admin/admin on first login)

## Workflow

- One squashed commit per feature unit (see [ADR 0003](decisions/0003-squash-per-feature.md)).
- Doc-only commits end with `[skip ci]` (see CLAUDE.md §8).
- Security-touching changes are audited by Larissa before squash (see CLAUDE.md §9).
- British English in every artefact committed to the repository (CLAUDE.md §7).

## Asking for help

When uncertain, raise the tension with Chris (the arbiter) rather than guessing. See CLAUDE.md §1.
