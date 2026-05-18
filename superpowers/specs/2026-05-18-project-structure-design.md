# Project Structure — Design Spec

**Date:** 2026-05-18
**For:** Liz (implementation), reviewed by Chris (arbiter)
**Unit name (for squash):** `Set up monorepo and tooling`
**Phase:** 0
**Brief lineage:** [`obsidian/briefs/phase 0/project-setup.md`](../../obsidian/briefs/phase%200/project-setup.md), informed by `auth-service.md` and `crypto.md`.
**Status:** Draft, awaiting Chris's review.

---

## 1. Goal

Stand up the Chatsundere monorepo skeleton: workspace tooling, dev infrastructure (Postgres, Redis, Prometheus, Grafana) with persistent volumes, empty-but-running stubs for every Phase-0–Phase-2 service and package, supporting documentation, CI, and an idempotent dev-setup script. After this unit, a fresh clone runs `green` across `pnpm install`, `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test`; `docker compose up -d` brings the data plane online; and `pnpm dev` starts every service and frontend in parallel — all of them serving real-but-trivial responses (`<h1>Chatsundere</h1>` on the frontends, `/healthz` `/readyz` `/metrics` on the backends).

No real service logic, no OPAQUE, no WebAuthn, no DB schema, no auth flows, no crypto implementation, no UI components. Those belong to subsequent units in the sequence outlined in §11.

## 2. Hard Constraints (already in CLAUDE.md but called out here)

1. Zero-knowledge architecture (CLAUDE.md §3.1) — this unit creates no surfaces that handle plaintext keys, but the *shape* of the surfaces (env-var separation per service, etc.) must not foreclose §3.1.
2. British English everywhere (CLAUDE.md §3.7) — every artefact emitted under this spec uses British spelling.
3. Prometheus from day one (CLAUDE.md §3.6) — even though no service has metrics worth scraping yet, the scrape pipeline exists end-to-end.
4. One squashed commit per feature unit (CLAUDE.md §8, ADR 0003) — this is one unit, one squash.

## 3. Directory Layout After This Unit

```
chatsundere/
├── apps/
│   ├── user-client/          Vite + React + Tailwind v4; empty <h1> page
│   ├── admin-client/         Vite + React + Tailwind v4; empty <h1> page, Catppuccin background
│   ├── auth-service/         Bun + Hono; /healthz /readyz /metrics only
│   ├── sync-service/         Bun + Hono; same three-endpoint skeleton
│   └── proxy-service/        Bun + Hono; same three-endpoint skeleton
├── packages/
│   ├── crypto/               Branded types, error class, all functions as stubs throwing CryptoError('internal', 'Stub')
│   ├── shared-types/         Wire-format type declarations (UserRole, AuthMethodType, Invitation, JWTClaims, ErrorEnvelope)
│   └── llm-unified/          Empty src/index.ts (Phase 2+, scaffolded so future squash is smaller)
├── infra/
│   ├── compose.dev.yml       Postgres 16 + Redis 7 + Prometheus + Grafana, bind-mount volumes under infra/data/
│   ├── compose.prod.yml.example  Same services with named volumes, Traefik labels, secrets via env
│   ├── postgres/init/01-create-databases.sh   Creates auth_db on first boot
│   ├── prometheus/prometheus.yml              scrape_configs for the three backend ports
│   └── grafana/provisioning/datasources/prometheus.yml  Prometheus as default datasource
├── obsidian/                 Existing vault (briefs/, decisions/, insights/) is preserved; this unit adds:
│   ├── ARCHITECTURE.md       TOC skeleton; sections filled as services land
│   └── ONBOARDING.md         How to clone → setup → up → dev
├── scripts/
│   └── setup-dev.sh          Idempotent: copies .env.example → .env for every app, creates infra/data/
├── .github/workflows/ci.yml  pnpm install / lint / typecheck / test / build
├── .editorconfig
├── .envrc                    Loads each service's .env, augments PATH
├── .gitignore                Extended: infra/data/, apps/*/.env, packages/*/.env
├── .mise.toml                Pins bun, node, pnpm
├── biome.json
├── lefthook.yml              pre-commit: biome; pre-push: pnpm typecheck
├── package.json              Workspace root; scripts: dev/build/test/lint/typecheck/format
├── pnpm-workspace.yaml
├── tsconfig.base.json        strict + noUncheckedIndexedAccess
├── turbo.json                Pipeline: build / typecheck / lint / test / dev (persistent)
├── LICENSE-AGPLv3
├── LICENSE-LGPLv3
├── LICENSE-MIT
└── README.md                 Mission, prerequisites, setup, env-var table, directory map, licensing
```

This layout follows the brief precisely with two named deviations (§10).

## 4. Workspace & Tooling Configuration

### 4.1 Package management
- **pnpm 9+** as package manager, via `packageManager` field in root `package.json` and Corepack.
- **`pnpm-workspace.yaml`** declares `apps/*` and `packages/*`.
- **Turborepo** as build orchestrator (build / typecheck / lint / test cached; `dev` persistent and uncached).

### 4.2 Versions pinned in `.mise.toml`
```toml
[tools]
bun = "latest"
node = "20"
pnpm = "9"
```
A fresh clone runs `mise install` to pull the right tools.

### 4.3 `tsconfig.base.json`
- `strict: true`
- `noUncheckedIndexedAccess: true`
- `target: ES2023`
- `module: ESNext`
- `moduleResolution: bundler`
- `isolatedModules: true`
- `verbatimModuleSyntax: true`

Each app and package extends this file.

### 4.4 Biome (`biome.json`)
- Single quotes for TypeScript.
- Line width 100.
- `organizeImports` on, formatter and linter both active.
- Ignores `dist`, `node_modules`, `infra/postgres/init`.

### 4.5 lefthook (`lefthook.yml`)
```yaml
pre-commit:
  parallel: true
  commands:
    biome:
      glob: '*.{ts,tsx,js,jsx,json}'
      run: pnpm exec biome check --no-errors-on-unmatched --files-ignore-unknown=true {staged_files}
pre-push:
  commands:
    typecheck:
      run: pnpm typecheck
```
Installed automatically via `"prepare": "lefthook install"` in root `package.json`.

### 4.6 Root `package.json` scripts
| Script | Command |
|---|---|
| `dev` | `turbo run dev` |
| `build` | `turbo run build` |
| `test` | `turbo run test` |
| `lint` | `biome check .` |
| `format` | `biome format --write .` |
| `typecheck` | `turbo run typecheck` |
| `prepare` | `lefthook install` |

### 4.7 `turbo.json` pipeline
- `build` → outputs `dist/**`, depends on `^build` (upstream packages first).
- `typecheck` → no outputs, depends on `^build`.
- `lint` → no outputs.
- `test` → depends on `build`.
- `dev` → `persistent: true`, no cache.

### 4.8 `.editorconfig`
UTF-8, LF, 2-space indent, trim trailing whitespace, final newline.

### 4.9 `.envrc` (repository root)
```bash
dotenv_if_exists apps/auth-service/.env
dotenv_if_exists apps/sync-service/.env
dotenv_if_exists apps/proxy-service/.env
PATH_add node_modules/.bin
```

## 5. Infrastructure — `infra/compose.dev.yml`

Four containers, all on a user-defined bridge network `chatsundere-dev`, all with healthchecks:

| Container | Image | Host port | Bind-mount |
|---|---|---|---|
| `postgres` | `postgres:16-alpine` | `5432` | `./data/postgres` → `/var/lib/postgresql/data`, plus `./postgres/init` → `/docker-entrypoint-initdb.d:ro` |
| `redis` | `redis:7-alpine --appendonly yes` | `6379` | `./data/redis` → `/data` |
| `prometheus` | `prom/prometheus:latest` | `9090` | `./data/prometheus` → `/prometheus`, `./prometheus/prometheus.yml` → `/etc/prometheus/prometheus.yml:ro` |
| `grafana` | `grafana/grafana:latest` | `3001` (mapped to container `3000`) | `./data/grafana` → `/var/lib/grafana`, `./grafana/provisioning` → `/etc/grafana/provisioning:ro` |

Credentials (dev only, hardcoded): Postgres user `chatsundere`, password `dev`, default DB `auth_db`. Grafana admin/admin (default — Grafana shows a password-change prompt on first login, which is fine for dev).

Healthchecks:
- Postgres: `pg_isready -U chatsundere`
- Redis: `redis-cli ping`
- Prometheus: `wget -qO- http://localhost:9090/-/healthy`
- Grafana: `wget -qO- http://localhost:3000/api/health`

### 5.1 Postgres init
`infra/postgres/init/01-create-databases.sh` runs only on first container creation (when `infra/data/postgres` is empty). It creates `auth_db` owned by `chatsundere`. A header comment documents adding `sync_db` and `proxy_db` when those services come online (their migrations will live in each service rather than in this init script, to keep schema ownership clean).

### 5.2 Prometheus scrape config
`infra/prometheus/prometheus.yml` has three scrape jobs (auth, sync, proxy) pointing at `host.docker.internal:3100/3200/3300/metrics` with `scrape_interval: 15s`. Until the services run, targets show DOWN — that is expected and visible in Prometheus UI.

### 5.3 Grafana datasource
`infra/grafana/provisioning/datasources/prometheus.yml` registers Prometheus (`http://prometheus:9090`) as the default datasource. No dashboards provisioned — premature in Phase 0.

### 5.4 Production compose example
`infra/compose.prod.yml.example` is structurally identical but:
- Uses named Docker volumes (`postgres_data`, `redis_data`, `prometheus_data`, `grafana_data`).
- Exposes no host ports for Postgres or Redis.
- Adds Traefik labels for Prometheus and Grafana with basic auth from `${TRAEFIK_USERS}`.
- Pulls Postgres credentials, Grafana admin password, etc. from environment variables — fails fast if unset.
- Header comment: copy to `compose.prod.yml`, fill in env vars, deploy with `docker compose -f compose.prod.yml up -d`.

`compose.prod.yml.example` is checked in; `compose.prod.yml` is gitignored.

## 6. Backend Service Stubs (`apps/auth-service`, `apps/sync-service`, `apps/proxy-service`)

Identical skeleton for all three:

```
apps/<service>/
├── src/
│   ├── index.ts           Entry — validates env, starts server, logs "<service> listening on :PORT"
│   ├── server.ts          createServer() — exported for tests
│   ├── routes/health.ts   GET /healthz, GET /readyz
│   ├── metrics.ts         prom-client default registry + middleware
│   ├── logger.ts          pino instance, pretty in dev, JSON in production
│   └── env.ts             Valibot schema, validated at boot; defaults baked in
├── tests/health.test.ts   bun test — boots server in-process, asserts 200 on /healthz, /readyz, /metrics
├── .env.example
├── package.json           "@chatsundere/auth-service" (etc.)
├── tsconfig.json          extends ../../tsconfig.base.json
├── README.md              "Run with pnpm --filter @chatsundere/auth-service dev"
└── LICENSE                AGPLv3 (file references ../../LICENSE-AGPLv3)
```

### 6.1 Endpoint behaviour
- `GET /healthz` → `{ "status": "ok" }`, 200.
- `GET /readyz` → 200 when required env vars are present (DB/Redis pings are added with the service implementation in the next unit). Returns 503 with `{ deps: { ... } }` otherwise. A stub `dependencies()` function lives in `src/routes/health.ts` and returns `{}` for now — it gains real probes in the next unit.
- `GET /metrics` → `prom-client` default-registry exposition (process metrics, GC, event loop lag — all from `collectDefaultMetrics`).

### 6.2 Default ports
- `auth-service` → `3100`
- `sync-service` → `3200`
- `proxy-service` → `3300`

### 6.3 `.env.example` per backend
The auth-service `.env.example` defines `NODE_ENV`, `PORT`, `LOG_LEVEL`, `DATABASE_URL`, `REDIS_URL`, `JWT_ISSUER`, `JWT_AUDIENCE`, and commented-out placeholders for `JWT_PRIVATE_KEY_PEM` and `CORS_ORIGINS`. Sync-service and proxy-service have analogous files with appropriate variables and commented Phase-1/Phase-2 placeholders (e.g., `S3_*` for sync, provider API keys for proxy).

## 7. Frontend Stubs (`apps/user-client`, `apps/admin-client`)

```
apps/<client>/
├── public/favicon.svg     Placeholder, Chatsundere "C"
├── src/
│   ├── main.tsx           React 18 createRoot mount
│   ├── App.tsx            <main><h1>Chatsundere</h1></main>
│   ├── index.css          @import 'tailwindcss';
│   └── env.ts             import.meta.env Valibot validation
├── index.html             Mobile-first viewport meta (user-client), Catppuccin body background (admin-client)
├── vite.config.ts         React plugin, Tailwind v4 plugin, fixed port
├── tsconfig.json
├── tsconfig.node.json     For vite.config.ts itself
├── package.json           "@chatsundere/user-client" / "@chatsundere/admin-client"
├── tailwind.config.ts     Empty @theme stub, ready for tokens
├── .env.example           VITE_AUTH_URL, VITE_SYNC_URL, VITE_PROXY_URL
├── README.md
└── LICENSE                AGPLv3
```

- **user-client** runs on `localhost:3000`, preloads Instrument Serif in `<head>`, mobile-first viewport meta.
- **admin-client** runs on `localhost:3010`, applies a Catppuccin-Mocha base background colour, uses sans-serif.

Neither has routing, state management, API calls, or auth components yet. The `<h1>` is genuinely all there is.

## 8. Package Stubs

### 8.1 `packages/shared-types` (MIT)
```
src/
├── index.ts         re-export
└── auth.ts          UserRole, AuthMethodType, Invitation, JWTClaims, ErrorEnvelope
```
Pure type declarations — no runtime code emitted. Types match the wire shapes documented in the auth-service brief so the service and clients can share them as soon as auth-service exists.

### 8.2 `packages/crypto` (LGPL-3.0)
```
src/
├── index.ts         Re-export of stubs.ts, types.ts, errors.ts
├── types.ts         Branded MasterKey, AMK, DEK, RecoveryKey, WrappedKey types
├── errors.ts        CryptoError class, CryptoErrorCode union
└── stubs.ts         Every function signature from the crypto brief; each throws new CryptoError('internal', 'Stub — implement in crypto unit')
SECURITY.md          Skeleton with explicit "TBD — fill before merging real crypto implementation"
```
Compiles cleanly under strict TS. Anyone who imports a stub function gets a clear runtime error rather than silent wrong behaviour. Tests in this package only assert that signatures exist; no behavioural tests yet.

### 8.3 `packages/llm-unified` (LGPL-3.0)
Truly empty — `src/index.ts` with `export {}` and a comment "Phase 2+ — provider adapters." The package exists so the workspace layout matches the brief from day one; the future "Add llm-unified" squash skips the package-creation overhead.

## 9. Documentation, README, CI, SPDX

### 9.1 `obsidian/ARCHITECTURE.md`
A pure table of contents with section headers and a one-sentence promise of what each section will cover:
- Overview & Mission
- Services & Boundaries
- Crypto Model (linking to `obsidian/briefs/phase 0/crypto.md`)
- Data Flow
- Threat Model
- Deployment Topology

Each section body says "_To be filled when the corresponding service lands._" Liz fills each section as part of the squash that ships that service.

### 9.2 `obsidian/ONBOARDING.md`
Onboarding for any contributor (including future Liz instances):
1. Prerequisites: `mise`, `docker` (with Compose v2), `git`, optional `direnv`.
2. `git clone …`, `mise install`, `pnpm install`.
3. `./scripts/setup-dev.sh` to seed `.env` files and create `infra/data/`.
4. `direnv allow` (optional but recommended).
5. `docker compose -f infra/compose.dev.yml up -d`.
6. `pnpm dev`.
7. Pointer: read CLAUDE.md before opening a PR.

### 9.3 `scripts/setup-dev.sh`
Idempotent. For each of the five apps (`auth-service`, `sync-service`, `proxy-service`, `user-client`, `admin-client`):
- If `apps/<app>/.env` exists, leave it alone and print a tick.
- Else copy `apps/<app>/.env.example` → `apps/<app>/.env` and print a tick.

Then `mkdir -p infra/data` (the four sub-directories are left to Docker to avoid permission surprises with container UIDs).

Prints `=== Dev setup complete ===` followed by next-step hints. ~30 lines, `set -euo pipefail`. No secret generation in this unit — that lands with the auth-service squash when there are real keys to generate.

### 9.4 Root `README.md`
Expanded from the current 89-byte stub to:
- Tagline and three-sentence mission.
- Status: "Private development. First public release at v0.1.0 — see ADR list."
- Prerequisites and quick-setup (linking to `obsidian/ONBOARDING.md` for detail).
- Directory layout table (matching CLAUDE.md §5).
- **Full table of every env variable**: service, name, purpose, example value. Per global preference in `~/.claude/CLAUDE.md`.
- Per-directory licensing card (apps/* AGPLv3, packages/crypto LGPL, packages/llm-unified LGPL, packages/shared-types MIT).
- Links to `obsidian/briefs/`, `obsidian/decisions/`, `obsidian/insights/`.

### 9.5 CI — `.github/workflows/ci.yml`
```yaml
name: CI
on:
  push: { branches: [master] }
  pull_request:
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: jdx/mise-action@v2
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm typecheck
      - run: pnpm test
      - run: pnpm build
```
GitHub Actions natively skips workflow runs when the commit subject contains `[skip ci]` (the form documented in CLAUDE.md §8) — no extra configuration needed.

### 9.6 SPDX headers
Every generated `.ts` and `.tsx` source stub starts with a single-line SPDX header:
- `apps/*/src/**`: `// SPDX-License-Identifier: AGPL-3.0-only`
- `packages/crypto/src/**`, `packages/llm-unified/src/**`: `// SPDX-License-Identifier: LGPL-3.0-only`
- `packages/shared-types/src/**`: `// SPDX-License-Identifier: MIT`

### 9.7 `.gitignore` additions
- `infra/data/` (Docker bind-mount targets — local data, never committed).
- `apps/*/.env`, `packages/*/.env` (defensive — the existing `.env` entry covers root, these cover nested).
- `infra/compose.prod.yml` (only the `.example` is committed).
- Existing entries (`node_modules`, `dist`, `*.tsbuildinfo`, `.envrc.local`, `keys/`) stay untouched.

## 10. Named Deviations From the Brief

1. **Compose file naming.** Brief specifies `infra/docker-compose.dev.yml`. We use `infra/compose.dev.yml` (Compose v2 spec). The `infra/` directory stays. No ADR — this is a tooling-convention rename, not an architectural decision.
2. **Commit convention.** Brief specifies Conventional Commits "for changelog generation later." CLAUDE.md §8 explicitly mandates free-form imperative without CC prefix and is the override-of-record under §3. We follow CLAUDE.md. No ADR — this is a doctrine question already settled at CLAUDE.md level. If we ever revisit, it will be its own ADR then.
3. **Admin-client port.** Brief does not specify ports for frontends. We pick `3000` for user-client and `3010` for admin-client (avoiding `3001` which Grafana occupies in our compose).
4. **Documentation home.** Brief and CLAUDE.md §6 both placed `ARCHITECTURE.md` and `ONBOARDING.md` under `docs/`. In reality `docs/` is already occupied by a static HTML teaser site for **chatsune.me** (GitHub Pages, `.nojekyll`, custom domain) prepared by Chris in parallel. Markdown documentation moves to `obsidian/` instead — flat-level files `obsidian/ARCHITECTURE.md` and `obsidian/ONBOARDING.md` alongside the existing `briefs/`, `decisions/`, `insights/` subfolders. CLAUDE.md §6 and §15 are amended in this unit to reflect the new convention; future docs (`DEPLOYMENT.md`, `RELEASE-PROCESS.md`, `SYNC.md`, `PROXY.md`) will likewise live in `obsidian/`.

These four deviations are intentional and minor. None contradict an existing ADR.

## 11. Unit Sequence Beyond This One

This unit is one of an implicit sequence. Recording it here so the next unit's spec can reference back:

1. **This unit:** Set up monorepo and tooling. *No Larissa audit* (no security-relevant code touched).
2. **Next unit:** Add auth-service — full OPAQUE + WebAuthn + Drizzle schema and migrations + admin endpoints + bootstrap CLI + integration tests. *Larissa audit (touches `apps/auth-service/**`).*
3. **Following unit:** Add crypto package — every primitive from the crypto brief, OPAQUE client wrapper, recovery-key encoding, MasterKeySession, error class. *Larissa audit (touches `packages/crypto/**`).*
4. **Then:** Wire user-client registration and login flows against the live auth-service.
5. **Then:** Wire admin-client login, user list, invitation creation.

Each entry above is its own squash and its own spec.

## 12. Manual Verification (Chris runs these)

The squash is "done" when these all pass on Chris's machine:

1. Fresh clone of the repository.
2. `mise install` pulls bun/node/pnpm at the pinned versions.
3. `pnpm install` succeeds; lefthook is installed in `.git/hooks/`.
4. `./scripts/setup-dev.sh` runs, creates five `.env` files and `infra/data/`. Running it a second time reports `exists, leaving alone` for each file (idempotent).
5. `direnv allow` populates env vars.
6. `docker compose -f infra/compose.dev.yml up -d` brings up four containers. `docker compose ps` shows all as `healthy` within ~30 s.
7. `pnpm dev` starts all three backends and both frontends in parallel via Turbo.
8. `http://localhost:3000` shows user-client "Chatsundere" with Instrument Serif on a mobile-first layout.
9. `http://localhost:3010` shows admin-client with the Catppuccin background.
10. `curl http://localhost:3100/healthz` → 200 `{"status":"ok"}`. Same for `:3200`, `:3300`.
11. `curl http://localhost:3100/readyz` → 200. Same for `:3200`, `:3300`.
12. `curl http://localhost:3100/metrics` → Prometheus exposition format. Same for `:3200`, `:3300`.
13. `http://localhost:9090` (Prometheus UI) → `/targets` lists three scrape targets; DOWN is acceptable when services aren't running and UP when they are.
14. `http://localhost:3001` (Grafana, `admin/admin`) → after the password-change prompt, the data-sources page lists Prometheus as provisioned and default.
15. `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test` — all green.
16. A trivial docs-only commit with `[skip ci]` in the subject is visible in GitHub Actions as a skipped run.
17. `rm -rf infra/data && docker compose -f infra/compose.dev.yml up -d` produces a fresh database, init script re-runs and creates `auth_db` again.
18. A `git commit` triggers lefthook and runs Biome on the staged files.

## 13. Out of Scope (deferred or already done)

- **`docs/` directory** — already exists as the chatsune.me HTML teaser site. This unit does not touch it. See deviation 4 in §10.
- Real DB schema or migrations (auth-service unit).
- Real `/readyz` dependency probes for Postgres/Redis (auth-service unit).
- OPAQUE, WebAuthn, JWT issuance, recovery flow (auth-service unit).
- Crypto primitives, OPAQUE client wrapper, recovery-key encoding (crypto unit).
- Any frontend routing, components, state, or API integration (frontend wiring unit).
- Real provider adapters for `packages/llm-unified` (Phase 2+).
- Production deployment, Traefik configuration, Hetzner setup (later phase).
- Grafana dashboards (premature without metrics worth viewing).

## 14. Risks and Mitigations

- **Risk:** `pnpm` + `bun --watch` + Turbo's persistent `dev` task interact in ways that produce flaky port-bound restarts. **Mitigation:** Each service binds to a fixed port and Bun is invoked via `bun --watch ./src/index.ts` directly, not through a wrapper. If problems show up, we fall back to `concurrently` later.
- **Risk:** Bind-mount permissions on `infra/data/postgres` differ between Linux and macOS contributors. **Mitigation:** We document the Linux developer setup as primary (Chris's). macOS contributors can adapt later; we keep the bind-mount paths simple so a switch to named volumes is one-line.
- **Risk:** Tailwind v4 is still relatively young and its Vite plugin has occasional rough edges. **Mitigation:** The frontend stub is so small that a regression is easy to fix; we pin Tailwind to a specific minor in `package.json` rather than caret-range to avoid surprise breakages.
- **Risk:** Biome flags code that Chris finds aesthetically wrong. **Mitigation:** This is a Phase 0 setup decision worth pushing through; the cost of switching to ESLint+Prettier later is bounded.

---

*End of spec. This document is committed as part of the unit's squash. Implementation plan follows in `superpowers/plans/`.*
