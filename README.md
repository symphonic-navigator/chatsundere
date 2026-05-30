# Chatsundere

> Chat + Tsuntsun towards regulation & censorship, Deredere towards the user.

End-to-end-encrypted, local-first AI companion platform. The backend stores
ciphertext only; it never sees user data, passphrases, or master keys. Users
join via QR-encoded one-time invitations. Anyone can self-host the backend
and build their own client against the same APIs.

**Status:** private development. The first public release is v0.1.0 — see
the ADRs under [`obsidian/decisions/`](obsidian/decisions/) for the trail.

## Quick start

Full instructions: [`obsidian/ONBOARDING.md`](obsidian/ONBOARDING.md).

```bash
git clone <this-repository> chatsundere
cd chatsundere
mise install
pnpm install
./scripts/setup-dev.sh
docker compose -f infra/compose.dev.yml up -d
pnpm dev
```

## Layout

| Directory | Contents |
|---|---|
| `apps/user-client` | PWA, mobile-first (port 3000) |
| `apps/admin-client` | Admin UI (port 3010) |
| `apps/auth-service` | OPAQUE + Passkey + JWT (port 3100) |
| `apps/sync-service` | Encrypted vault (Phase 1, port 3200) |
| `apps/proxy-service` | Authenticated LLM proxy (Phase 2, port 3300) |
| `packages/crypto` | Client-side crypto primitives |
| `packages/shared-types` | Wire-format TypeScript types |
| `packages/llm-unified` | Provider adapters (Phase 2+) |
| `infra/` | Docker Compose, Prometheus, Grafana provisioning |
| `docs/` | Public teaser site for chatsune.me (HTML, no Markdown rendering) |
| `obsidian/` | Vault — briefs, ADRs, insights, architecture and onboarding docs |
| `scripts/` | Bootstrap and helper scripts |
| `superpowers/` | Specs and implementation plans |

## Environment variables

Every service has its own `.env.example`. After `scripts/setup-dev.sh` runs, you have working `.env` files for development.

### `apps/auth-service`

| Variable | Purpose | Example |
|---|---|---|
| `NODE_ENV` | `development` / `production` / `test` | `development` |
| `PORT` | HTTP listening port | `3100` |
| `LOG_LEVEL` | pino level | `debug` |
| `DATABASE_URL` | Postgres connection string for `auth_db` | `postgres://chatsundere:dev@localhost:5432/auth_db` |
| `REDIS_URL` | Redis connection (DB 0) | `redis://localhost:6379/0` |
| `JWT_ISSUER` | `iss` claim issued in access tokens | `chatsundere-auth` |
| `JWT_AUDIENCE` | `aud` claim issued in access tokens | `chatsundere-services` |
| `JWT_PRIVATE_KEY_PEM` | Ed25519 signing key (generated in auth-service unit) | _(commented)_ |
| `CORS_ORIGINS` | Comma-separated allowed origins | _(commented)_ |

### `apps/sync-service`

| Variable | Purpose | Example |
|---|---|---|
| `NODE_ENV`, `PORT`, `LOG_LEVEL` | as above | `3200` |
| `DATABASE_URL` | `sync_db` (created when sync-service ships its schema) | `postgres://chatsundere:dev@localhost:5432/sync_db` |
| `REDIS_URL` | Redis (DB 1) | `redis://localhost:6379/1` |
| `JWT_ISSUER`, `JWT_AUDIENCE` | match auth-service | `chatsundere-auth`, `chatsundere-services` |
| `AUTH_JWKS_URL` | Where to fetch the auth-service public JWKS | `http://localhost:3100/v1/jwks` |
| `S3_*` | Vault blob storage (Phase 1) | _(commented)_ |

### `apps/proxy-service`

| Variable | Purpose | Example |
|---|---|---|
| `NODE_ENV`, `PORT`, `LOG_LEVEL` | as above | `3300` |
| `DATABASE_URL` | `proxy_db` (Phase 2) | `postgres://chatsundere:dev@localhost:5432/proxy_db` |
| `REDIS_URL` | Redis (DB 2) | `redis://localhost:6379/2` |
| `JWT_ISSUER`, `JWT_AUDIENCE` | match auth-service | as above |
| `AUTH_JWKS_URL` | as above | `http://localhost:3100/v1/jwks` |
| `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, … | Upstream LLM provider keys (Phase 2+) | _(commented)_ |

### `apps/user-client` and `apps/admin-client`

| Variable | Purpose | Example |
|---|---|---|
| `VITE_AUTH_URL` | Auth-service base URL | `http://localhost:3100` |
| `VITE_SYNC_URL` | Sync-service base URL | `http://localhost:3200` |
| `VITE_PROXY_URL` | Proxy-service base URL | `http://localhost:3300` |

## Curating model & provider support

Model and provider support in `packages/llm-unified` is curated by maintainers
with the **`/curate` skill** ([`.claude/skills/curate/`](.claude/skills/curate/)) —
an interactive Claude Code workflow rather than a one-shot CLI. Reach for it to
onboard a provider, integrate a model, or verify and repair a misbehaving
offering (e.g. a tool call failing on a given provider). Adapters are validated
against real end-to-end protocol behaviour via a deterministic conversation-suite,
run locally — never in CI, since provider keys never enter CI. The skill's
`references/` hold the per-mode playbooks; start at
[`SKILL.md`](.claude/skills/curate/SKILL.md).

## Versioning & deployment

This repo follows a `version.txt`-driven scheme adapted from
[chatsune](https://github.com/symphonic-navigator/chatsune). The base
version lives in `version.txt` at the repo root.

- A push to `master` builds `<base>-pre.<run-number>` and deploys to
  `https://teaser.chatsundere.me/alpha/`.
- A push of an annotated tag `vX.Y.Z` (matching `version.txt`) builds
  `X.Y.Z` and replaces the `/alpha/` deployment.

The current alpha-deploy is a PWA served from GitHub Pages alongside
the public teaser site. There is intentionally no link from the teaser
to the alpha — access is invite-only by URL.

See `superpowers/specs/2026-05-26-phase-4-alpha-prep-design.md` for
the full design.

## Licensing

| Path | Licence | Why |
|---|---|---|
| `apps/*` | AGPL-3.0-only | Server software stays copyleft, including network use |
| `packages/crypto` | LGPL-3.0-only | Reusable in other projects, improvements come back |
| `packages/llm-unified` | LGPL-3.0-only | Same as crypto |
| `packages/shared-types` | MIT | Pure types, trivially reusable |
| `docs/` | _(see chatsune.me site)_ | Marketing site |

See [ADR 0002](obsidian/decisions/0002-agplv3-for-apps.md) for the AGPL choice.

## Further reading

- [Lyra's design briefs](obsidian/briefs/)
- [ADRs](obsidian/decisions/)
- [Project journal](obsidian/insights/)
- [Architecture](obsidian/ARCHITECTURE.md) _(skeleton, filled as services land)_
- [The `/curate` skill](.claude/skills/curate/) — curating model & provider support
