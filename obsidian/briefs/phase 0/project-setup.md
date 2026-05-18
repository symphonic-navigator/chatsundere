# Chatsundere — Project Setup Briefing

**For:** Liz (implementation)
**From:** Lyra (architecture) + Chris (vision)
**Status:** Phase 0 — initial monorepo setup and auth-service
**Date:** 2026-05-18

---

## Project Vision (1 paragraph)

Chatsundere is a fully E2EE, local-first AI companion platform consisting of:
a thin authenticated proxy, an encrypted sync backend, a passkey-and-OPAQUE
auth service, and a mobile-first PWA client. The backend stores only
ciphertext and never sees user data, passphrases, or master keys. Users
are invited via QR-code-encoded one-time tokens. The system is built so
that anyone can self-host the backend and even build their own client
against the same APIs.

## Hard Requirements

1. **Zero-knowledge backend.** The server must never have the ability
   to decrypt user data. No passphrase, master key, or DEK in plaintext
   touches the server. Ever. This is non-negotiable.
2. **OPAQUE for passphrase auth.** No `POST /login { password: "..." }`.
   We use OPAQUE (RFC 9807) so the password never crosses the wire.
3. **Passkey is first-class.** WebAuthn with PRF extension is the
   primary auth method. OPAQUE is the fallback for users without
   PRF-capable platforms.
4. **Mobile-first UI.** The client is designed for 380px viewports
   first; desktop is a constrained-width version of the same UI.
5. **AGPLv3 server, LGPLv3 libraries, MIT for shared types.** See
   licensing section below.
6. **Prometheus metrics from day one.** Every service exposes
   `/metrics` and meaningful counters/histograms.

## Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript everywhere | One language across client/server/libs |
| Server runtime | Bun (latest stable) | Fast startup, native TS, single binary builds |
| Server framework | Hono | Tiny, fast, excellent TS DX, runs on Bun |
| Database | PostgreSQL 16+ | ACID, mature, well-known, great TS tooling |
| ORM | Drizzle | Type-safe, migrations-as-TS, no codegen weirdness |
| Cache/Pubsub | Redis 7+ | Rate limits, session state, WS pubsub later |
| Metrics | prom-client | Prometheus standard, well-maintained |
| Frontend | React 18 + Vite | Familiar, fast dev, good PWA support |
| Styling | Tailwind v4 | Mobile-first, atomic, custom theme |
| State | TanStack Query + Zustand | Server state + client state separation |
| Crypto (client) | @serenity-kit/opaque + WebCrypto API | Audited, RFC 9807 compliant |
| WebAuthn (server) | @simplewebauthn/server | Mature, well-maintained |
| JWT | jose | Modern, supports modern algos |
| Validation | Valibot or Zod | Pick one and stick to it; lean toward Valibot for bundle size |
| Logging | pino | Fast, structured, plays nice with everything |

## Monorepo Layout

```
chatsundere/
├── apps/
│   ├── user-client/      # PWA, mobile-first, AGPLv3
│   ├── admin-client/     # Desktop-first admin UI, AGPLv3
│   ├── auth-service/     # OPAQUE + Passkey + JWT, AGPLv3
│   ├── sync-service/     # Vault (Phase 1), AGPLv3
│   └── proxy-service/    # Authenticated CORS proxy (Phase 2), AGPLv3
├── packages/
│   ├── crypto/           # Client-side crypto primitives, LGPLv3
│   ├── shared-types/     # Wire-format TS types, MIT
│   └── llm-unified/      # (Phase 2+) Provider adapters, LGPLv3
├── infra/
│   ├── docker-compose.dev.yml
│   ├── docker-compose.prod.yml.example
│   └── prometheus/
│       └── prometheus.yml
├── docs/
│   ├── ARCHITECTURE.md
│   ├── CRYPTO.md
│   └── ONBOARDING.md
├── .github/
│   └── workflows/
├── package.json
├── pnpm-workspace.yaml
├── turbo.json
├── tsconfig.base.json
├── .editorconfig
├── .gitignore
├── LICENSE-AGPLv3
├── LICENSE-LGPLv3
├── LICENSE-MIT
└── README.md
```

## Tooling

- **Package manager:** pnpm 9+
- **Workspace orchestrator:** Turborepo (for parallel builds, caching)
- **Lint/Format:** Biome (replaces ESLint + Prettier, very fast)
- **Tests:** Bun's built-in test runner for backend, Vitest for frontend
- **Git hooks:** lefthook (lightweight, replaces husky)
- **Commit convention:** Conventional Commits (for changelog generation later)

## Licensing

- All `apps/*` → **AGPLv3**. Add LICENSE file to each app referencing the
  root LICENSE-AGPLv3. The intent: server software and full products are
  copyleft including network use.
- `packages/crypto` → **LGPLv3**. We want this reusable in other projects
  but improvements must come back.
- `packages/llm-unified` → **LGPLv3**. Same reasoning.
- `packages/shared-types` → **MIT**. Just types, trivially reusable.

Each package has a `LICENSE` file. Add SPDX-License-Identifier headers
to all source files where reasonable.

## Database Strategy

- Each service has its own database in the same Postgres cluster:
  - `auth_db` for auth-service
  - `sync_db` for sync-service (Phase 1)
  - `proxy_db` for proxy-service (Phase 2)
- No cross-database foreign keys. Services know users by UUID only.
- Migrations live in each service's `migrations/` directory, managed
  via Drizzle Kit.

## Environment Variables Strategy

- Each service has a `.env.example` in its directory.
- `.env` files are gitignored.
- Secrets are loaded via Bun's built-in `Bun.env` (which reads `.env`).
- For production: document how to inject via Docker env, no special handling.
- Schema validation of env vars at service startup using Valibot/Zod.

## Prometheus Integration

Every service must expose:

- `GET /metrics` — Prometheus exposition format
- `GET /healthz` — liveness probe, returns 200 if process is up
- `GET /readyz` — readiness probe, returns 200 if DB + Redis reachable

Default metrics to expose:

- `http_requests_total{method, route, status}` — counter
- `http_request_duration_seconds{method, route}` — histogram
- `db_queries_total{operation, table}` — counter (where applicable)
- `db_query_duration_seconds{operation, table}` — histogram
- Service-specific counters (see each service's briefing)

## Logging Strategy

- Structured JSON logs via pino
- Log levels: trace, debug, info, warn, error, fatal
- Include `request_id` in every log line during request handling
- Include `user_id` where applicable (NEVER include passphrases, tokens,
  or any cryptographic material)
- Log levels configurable via env `LOG_LEVEL`

## Docker Compose for Dev

`infra/docker-compose.dev.yml` should bring up:

- PostgreSQL 16 (port 5432)
- Redis 7 (port 6379)
- Prometheus (port 9090) — scraping local services
- (Optional) Grafana (port 3000) — pre-configured Prometheus datasource

Services themselves run locally via `bun --watch` for hot-reload during dev.

## Quality Bar

- Strict TypeScript (`strict: true`, `noUncheckedIndexedAccess: true`)
- No `any` without a comment explaining why
- All public functions exported from a package have JSDoc with at least
  a one-line description
- Critical paths (auth, crypto, encryption) get unit tests from day one
- Integration tests for auth flows (registration, login, password change,
  passkey add, recovery)

## Naming Conventions

- Service names: kebab-case (`auth-service`, `user-client`)
- Package names in `package.json`: `@chatsundere/auth-service`, `@chatsundere/crypto`
- Database names: snake_case (`auth_db`, `sync_db`)
- Table names: snake_case plural (`users`, `auth_methods`, `invitations`)
- Column names: snake_case
- TS types/interfaces: PascalCase (`AuthMethod`, `User`)
- TS functions/variables: camelCase
- Constants: SCREAMING_SNAKE_CASE
- Env vars: SCREAMING_SNAKE_CASE with service prefix where needed
  (`AUTH_DB_URL`, `SYNC_REDIS_URL`)

## What to Do First (suggested order)

1. Initialize monorepo: pnpm workspaces + Turborepo + Biome + tsconfig.base.json
2. Add `infra/docker-compose.dev.yml` with Postgres + Redis + Prometheus
3. Create `packages/shared-types` skeleton with initial auth types
4. Create `packages/crypto` skeleton (interfaces, no impl yet)
5. Create `apps/auth-service` — see BRIEFING-AUTH-SERVICE.md
6. Create `apps/user-client` skeleton with Vite + React + Tailwind
7. Create `apps/admin-client` skeleton
8. Implement auth-service per its briefing
9. Implement crypto package per its briefing
10. Wire up user-client registration + login flows
11. Wire up admin-client login + user list + invitation creation

## Open Decisions Liz Should Defer to Chris/Lyra

- Choice of UI component library (headless+Tailwind vs NextUI vs Ionic).
  Default: headless+Tailwind+vaul+framer-motion until Chris says otherwise.
- PWA manifest details and theming (icons, name, theme color).
- Push notification strategy (deferred to later phase).
