# Deployment Kit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the first real deploy of the whole Chatsundere backend — a single backend container image plus a two-phase, secret-generating install kit that stands the full stack up behind an existing Traefik.

**Architecture:** One Bun backend image runs all three services (auth/sync/proxy) selected by `command:`. The admin-client is baked into the frontend image under `/admin/` for same-origin. A `deploy/` kit renders a unified `docker-compose.yml` (frontend + backend ×3 + postgres/redis/minio + optional monitoring + scoped watchtower) from a template; `generate.sh` (local, `openssl`-only) mints random secrets and renders the compose, `install.sh` (server) mints the MinIO scoped key + OPAQUE setup once, brings the stack up, and bootstraps the first admin.

**Tech Stack:** Docker multi-stage (Bun `oven/bun:1-alpine`, nginx `1.27-alpine`), Docker Compose, Traefik (external), MinIO + `mc`, GitHub Actions + cosign, POSIX bash + openssl.

## Global Constraints

- **British English** in every artefact — code, comments, commit messages, docs, log strings (CLAUDE.md §3.7).
- **Backend image name:** `ghcr.io/symphonic-navigator/chatsundere-backend`. **Frontend image name (existing):** `ghcr.io/symphonic-navigator/chatsundere-frontend`.
- **`:latest` moves ONLY on a `v*.*.*` tag** — `type=raw,value=latest,enable=${{ startsWith(github.ref, 'refs/tags/v') }}` (mirror the frontend job exactly).
- **Ports (internal):** auth `PORT=3100`; sync `PORT=3200` / `OPS_PORT=9091`; proxy `PORT=8080` / `OPS_PORT=9090`. OPS ports (`/healthz` `/readyz` `/metrics`) are **never** Traefik-routed.
- **Only Traefik binds host ports 80/443.** Postgres, Redis, MinIO carry **no** `ports:` entry.
- **Secrets live only in `deployment.env`** (git-ignored in the generated `out/`). The committed `deployment.env.template` holds placeholders only. `install.sh` chmods `deployment.env` `600`.
- **`OPAQUE_SERVER_SETUP` is generate-once** — `install.sh` must never overwrite a filled value (a re-run bricking every account's passphrase auth is a critical failure).
- **MinIO scoped key, never root** for the sync-service; object versioning/ILM stay OFF.
- **Blobs congruence:** sync `S3_ENDPOINT=http://minio:9000` and auth `SYNC_BLOBS_ENABLED=true` are set together.
- **CLI entrypoints inside the backend image:** `bun run --cwd apps/auth-service generate-opaque-setup`, `bun run --cwd apps/auth-service bootstrap-admin`, `bun apps/sync-service/tools/re-epoch.ts`.
- **Larissa audits Unit 2 before its squash** (secret gen, MinIO scoping, network exposure). Unit 1 (image/CI) is her call.
- **Two squash units:** Unit 1 = backend image + admin-in-frontend + CI; Unit 2 = deploy kit + doc congruence.

---

## File Structure

**Unit 1**
- Create `apps/backend/Dockerfile` — multi-stage Bun image carrying all three services + their CLIs.
- Modify `apps/user-client/Dockerfile` — also build `apps/admin-client`, copy its `dist` to `/usr/share/nginx/html/admin/`.
- Modify `apps/user-client/nginx.conf` — add `/admin/` SPA-fallback location with the isolation headers.
- Modify `.github/workflows/docker.yml` — add a `build-backend` job.
- Modify root `.dockerignore` if needed (ensure it does not exclude `apps/*-service/src` or `apps/admin-client`).

**Unit 2**
- Create `deploy/deployment.env.template` — one consolidated, documented env file (placeholders only).
- Create `deploy/compose.template.yml` — unified stack; optional monitoring/watchtower blocks delimited for the renderer.
- Create `deploy/postgres-init/01-create-databases.sh` — prod DB init (auth_db + sync_db, no test DBs).
- Create `deploy/generate.sh` — Script A (local).
- Create `deploy/install.sh` — Script B (server).
- Create `deploy/README.md` — quickstart + pointer to `obsidian/DEPLOYMENT.md`.
- Delete `infra/compose.prod.yml.example` — superseded by the template.
- Modify `obsidian/DEPLOYMENT.md` — chapters 4–6 describe the generator flow; fix the proxy-port row (`8080`, not `3300`).

---

## UNIT 1 — Backend image, admin-in-frontend, CI

### Task 1: Backend Dockerfile

**Files:**
- Create: `apps/backend/Dockerfile`
- Reference: `apps/user-client/Dockerfile` (layer-ordering pattern), `apps/auth-service/package.json` (scripts), `infra/compose.dev.yml` (throwaway infra for the boot check)

**Interfaces:**
- Produces: an image runnable as `bun apps/<svc>-service/src/index.ts` and as the CLIs in Global Constraints. Later compose tasks depend on those exact commands.

- [ ] **Step 1: Write the Dockerfile**

Create `apps/backend/Dockerfile`:

```dockerfile
# syntax=docker/dockerfile:1
# Backend image — carries all three Bun services (auth/sync/proxy) and their
# CLI entrypoints. The compose selects a service via `command:`. Build context
# is the REPO ROOT so the pnpm workspace resolves. Multi-stage; cheap layers
# first so source edits do not re-run the dependency install.
#
# The repo is a PNPM workspace (packageManager pnpm@9.15.0, pnpm-lock.yaml) —
# install with pnpm via corepack (exactly like apps/user-client/Dockerfile),
# then RUN the services on Bun. Do NOT use `bun install` here: there is no bun
# lockfile, so `bun install --frozen-lockfile` would fail. The services import
# only @chatsundere/crypto and @chatsundere/shared-types (both tsc-built), so
# only those two workspace packages need building.

# ---------- Build stage ----------
FROM node:22-alpine AS builder
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

# 1. Manifests first → install cached until a manifest or the lockfile moves.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json biome.json ./
COPY apps/auth-service/package.json apps/auth-service/
COPY apps/sync-service/package.json apps/sync-service/
COPY apps/proxy-service/package.json apps/proxy-service/
COPY packages/crypto/package.json packages/crypto/
COPY packages/shared-types/package.json packages/shared-types/
# --ignore-scripts: the root `prepare` runs `lefthook install` (needs git, absent
# here) and skips native postinstalls the services do not use at runtime.
RUN pnpm install --frozen-lockfile --ignore-scripts

# 2. Build the two workspace packages the services consume from dist/ (tsc).
COPY packages/ packages/
RUN pnpm --filter @chatsundere/shared-types --filter @chatsundere/crypto build

# 3. Service source (cheapest to invalidate → last).
COPY apps/auth-service/ apps/auth-service/
COPY apps/sync-service/ apps/sync-service/
COPY apps/proxy-service/ apps/proxy-service/

# ---------- Runtime stage ----------
FROM oven/bun:1-alpine

ARG VERSION=0.0.0-dev
ARG GIT_SHA=""
ARG BUILT_AT=""

WORKDIR /app
# Copy the whole installed tree (pnpm's node_modules symlink farm + built dist +
# service source). Docker preserves symlinks; Bun resolves node_modules normally.
COPY --from=builder /app /app

# Version marker (frontend parity).
RUN printf '%s\n' "$VERSION ($GIT_SHA, $BUILT_AT)" > /app/VERSION

# Runs as the image's built-in non-root `bun` user.
USER bun

# No default command — the compose sets one of:
#   bun apps/auth-service/src/index.ts
#   bun apps/sync-service/src/index.ts
#   bun apps/proxy-service/src/index.ts
# CLIs (compose exec / one-shot run):
#   bun run --cwd apps/auth-service generate-opaque-setup
#   bun run --cwd apps/auth-service bootstrap-admin
#   bun apps/sync-service/tools/re-epoch.ts
```

- [ ] **Step 2: Build the image locally**

Run: `docker build -f apps/backend/Dockerfile -t chatsundere-backend:dev --build-arg VERSION=0.2.0-dev .`
Expected: build succeeds; final image tagged `chatsundere-backend:dev`.

- [ ] **Step 3: Verify the three entrypoints and a CLI resolve**

Run:
```bash
docker run --rm chatsundere-backend:dev bun --version
docker run --rm chatsundere-backend:dev sh -c 'ls apps/auth-service/src/index.ts apps/sync-service/src/index.ts apps/proxy-service/src/index.ts apps/sync-service/tools/re-epoch.ts'
docker run --rm chatsundere-backend:dev bun run --cwd apps/auth-service generate-opaque-setup
```
Expected: Bun version prints; all four paths list without error; `generate-opaque-setup` prints an OPAQUE setup string to stdout (this is exactly what `install.sh` will capture — confirm it is a single non-empty line).

- [ ] **Step 4: Boot-verify one service against the dev infra**

Run:
```bash
docker compose -f infra/compose.dev.yml up -d postgres redis
docker run --rm --network chatsundere-dev_chatsundere-dev \
  -e NODE_ENV=production -e PORT=3100 -e OPS_PORT=9099 \
  -e API_BASE_URL=http://localhost:3100/auth \
  -e DATABASE_URL=postgres://chatsundere:dev@postgres:5432/auth_db \
  -e REDIS_URL=redis://redis:6379/0 \
  -e AUTH_JWT_PRIVATE_KEY="$(openssl rand 32 | basenc --base64url | tr -d '=')" \
  -e OPAQUE_SERVER_SETUP="$(docker run --rm chatsundere-backend:dev bun run --cwd apps/auth-service generate-opaque-setup)" \
  -e INVITATION_HMAC_KEY="$(openssl rand 32 | basenc --base64url | tr -d '=')" \
  -e REFRESH_TOKEN_HMAC_KEY="$(openssl rand 32 | basenc --base64url | tr -d '=')" \
  -e HMAC_KEY_PENDING_CODES="$(openssl rand 32 | basenc --base64url | tr -d '=')" \
  -e CORS_ALLOWED_ORIGINS=http://localhost:3000 \
  -p 3100:3100 chatsundere-backend:dev bun apps/auth-service/src/index.ts &
sleep 4
curl -fsS http://localhost:3100/api/v1/config && echo OK
```
Expected: auth-service boots (migrations run), `/api/v1/config` returns JSON. Stop it and the infra afterwards (`docker compose -f infra/compose.dev.yml down`). If the network name differs, resolve it with `docker network ls | grep chatsundere-dev`.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/Dockerfile
git commit -m "Add backend container image carrying all three Bun services"
```

---

### Task 2: Admin-client baked into the frontend image

**Files:**
- Modify: `apps/user-client/Dockerfile`
- Modify: `apps/user-client/nginx.conf`
- Reference: `apps/admin-client/vite.config.ts` (`base: '/admin/'`)

**Interfaces:**
- Produces: the frontend image serves the admin SPA at `/admin/`. `ADMIN_PUBLIC_URL=https://app.<base>/admin/` (set in Unit 2 env) depends on this.

- [ ] **Step 1: Build the admin-client in the frontend Dockerfile**

In `apps/user-client/Dockerfile`, after the client build (`RUN … pnpm --filter user-client build`), add an admin build. The admin `base` is already `/admin/`, so its assets resolve correctly. Insert:

```dockerfile
# 5. Build the admin-client (Vite base already '/admin/') so the frontend image
#    serves it same-origin under /admin/ — required for it to read the
#    user-client's IndexedDB account (a different origin shows "No account").
COPY apps/admin-client/ apps/admin-client/
RUN VITE_BASE=/admin/ pnpm --filter admin-client build
```

Note: `apps/admin-client/package.json` must already be copied in the manifest block (it is — line for `apps/admin-client/package.json` exists). Confirm the earlier `COPY packages/ packages/` and install cover admin's deps; if admin needs `@chatsundere/ui-shared`/`shared-types` dist, they are already built in step 3.

- [ ] **Step 2: Copy the admin dist into the runtime image**

In the runtime stage of `apps/user-client/Dockerfile`, after the existing `COPY --from=builder /app/apps/user-client/dist /usr/share/nginx/html`, add:

```dockerfile
COPY --from=builder /app/apps/admin-client/dist /usr/share/nginx/html/admin
```

- [ ] **Step 3: Add the `/admin/` nginx location**

In `apps/user-client/nginx.conf`, after the `location = /index.html { … }` block, add:

```nginx
    # Admin console SPA, baked in same-origin so it shares the user-client's
    # IndexedDB. Its own client-side routes fall back to the admin index.
    location /admin/ {
        try_files $uri $uri/ /admin/index.html;
        add_header Cross-Origin-Opener-Policy "same-origin" always;
        add_header Cross-Origin-Embedder-Policy "credentialless" always;
        add_header Cross-Origin-Resource-Policy "same-origin" always;
    }
```

- [ ] **Step 4: Build and verify `/admin/` is served with isolation headers**

Run:
```bash
docker build -f apps/user-client/Dockerfile -t chatsundere-frontend:dev --build-arg VERSION=0.2.0-dev .
docker run --rm -d -p 8088:80 --name cs-fe chatsundere-frontend:dev
sleep 1
curl -fsS -o /dev/null -w '%{http_code}\n' http://localhost:8088/admin/
curl -sI http://localhost:8088/admin/ | grep -i cross-origin
docker rm -f cs-fe
```
Expected: `/admin/` returns `200`; the three `Cross-Origin-*` headers are present. (A deep-link like `/admin/users` should also return the admin index — optionally `curl` it.)

- [ ] **Step 5: Commit**

```bash
git add apps/user-client/Dockerfile apps/user-client/nginx.conf
git commit -m "Bake admin-client into the frontend image under /admin/"
```

---

### Task 3: CI job for the backend image

**Files:**
- Modify: `.github/workflows/docker.yml`

**Interfaces:**
- Produces: `ghcr.io/symphonic-navigator/chatsundere-backend` pushed on the same triggers as the frontend, `:latest` tag-gated.

- [ ] **Step 1: Add the backend image env and a parallel job**

In `.github/workflows/docker.yml`, add under `env:`:

```yaml
  BACKEND_IMAGE: ghcr.io/symphonic-navigator/chatsundere-backend
```

Then add a `build-backend` job mirroring `build-frontend` verbatim except: `id`/`name` say backend; the `Extract Docker metadata` step uses `images: ${{ env.BACKEND_IMAGE }}` with the identical `tags:` list; the `Build and push` step uses `file: apps/backend/Dockerfile`; and both cache steps use `scope=backend`. Keep the same `Compute version`, cosign signing, and build-args (`VERSION`/`GIT_SHA`/`BUILT_AT`) steps.

- [ ] **Step 2: Validate the workflow YAML**

Run: `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/docker.yml'))" && echo VALID`
Expected: `VALID`. Also eyeball that `build-backend` has its own `permissions:` block (`contents: read`, `packages: write`, `id-token: write`).

- [ ] **Step 3: Confirm `:latest` gating is present on the backend metadata step**

Run: `grep -c "startsWith(github.ref, 'refs/tags/v')" .github/workflows/docker.yml`
Expected: `2` (one per job).

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/docker.yml
git commit -m "Build and push the backend image in CI alongside the frontend"
```

**End of Unit 1.** Verify all three images/artefacts, then this is the first squash unit ("Add backend container image and CI; bake admin console into the frontend image"). Larissa optional (image/CI only).

---

## UNIT 2 — Deploy kit + doc congruence

### Task 4: `deployment.env.template`

**Files:**
- Create: `deploy/deployment.env.template`
- Reference: the three `apps/*-service/.env.example` files (source of truth for names/defaults)

**Interfaces:**
- Produces: every variable the compose interpolates. `generate.sh` fills the random ones; `install.sh` fills `OPAQUE_SERVER_SETUP`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`.

- [ ] **Step 1: Write the template**

Create `deploy/deployment.env.template` (placeholders only, grouped):

```bash
# Chatsundere deployment environment — generated file.
# `generate.sh` fills the CHANGE-ME-GENERATED values; `install.sh` fills the
# CHANGE-ME-ON-SERVER values on first run. Keep this file secret (chmod 600)
# and BACK IT UP — OPAQUE_SERVER_SETUP and the HMAC/JWT keys are irreplaceable.

# ── Domains ─────────────────────────────────────────────────────────────
BASE_DOMAIN=example.com
HOST_APP=app.example.com
HOST_AUTH=auth.example.com
HOST_SYNC=sync.example.com
HOST_PROXY=proxy.example.com
# Monitoring hosts — only used when the monitoring block is rendered in.
HOST_PROMETHEUS=prometheus.example.com
HOST_GRAFANA=grafana.example.com
# The existing Traefik's external docker network.
TRAEFIK_NETWORK=traefik
# Traefik cert resolver name (as configured in your Traefik).
TRAEFIK_CERTRESOLVER=letsencrypt

# ── Public URLs derived for the services ────────────────────────────────
API_BASE_URL=https://auth.example.com/auth
PROXY_PUBLIC_URL=https://proxy.example.com
SYNC_PUBLIC_URL=https://sync.example.com
ADMIN_PUBLIC_URL=https://app.example.com/admin/
CORS_ALLOWED_ORIGINS=https://app.example.com
JWT_ISSUER=chatsundere-auth-v1
JWT_AUDIENCE=chatsundere-services
AUTH_JWKS_URL=http://auth:3100/api/v1/jwks
SYNC_BLOBS_ENABLED=true

# ── Secrets (generate.sh fills these) ───────────────────────────────────
POSTGRES_USER=chatsundere
POSTGRES_PASSWORD=CHANGE-ME-GENERATED
MINIO_ROOT_USER=CHANGE-ME-GENERATED
MINIO_ROOT_PASSWORD=CHANGE-ME-GENERATED
GRAFANA_ADMIN_USER=admin
GRAFANA_ADMIN_PASSWORD=CHANGE-ME-GENERATED
# htpasswd apr1 line(s) for the monitoring basic-auth middleware.
TRAEFIK_AUTH_USERS=CHANGE-ME-GENERATED
AUTH_JWT_PRIVATE_KEY=CHANGE-ME-GENERATED
INVITATION_HMAC_KEY=CHANGE-ME-GENERATED
REFRESH_TOKEN_HMAC_KEY=CHANGE-ME-GENERATED
HMAC_KEY_PENDING_CODES=CHANGE-ME-GENERATED

# ── Secrets (install.sh fills these on the server) ──────────────────────
# OPAQUE long-term key material — generated ONCE by install.sh. Never rotate.
OPAQUE_SERVER_SETUP=CHANGE-ME-ON-SERVER
# MinIO scoped access key (bucket-limited, NOT the root credential).
S3_ENDPOINT=http://minio:9000
S3_REGION=us-east-1
S3_BUCKET=chatsundere-blobs
S3_ACCESS_KEY_ID=CHANGE-ME-ON-SERVER
S3_SECRET_ACCESS_KEY=CHANGE-ME-ON-SERVER

# ── Tunables (defaults from the service .env.example files) ──────────────
LOG_LEVEL=info
TRUST_PROXY_HOPS=1
RATE_LIMIT_USER_PER_MIN=120
RATE_LIMIT_IP_PER_MIN=600
RATE_LIMIT_DELETE_PER_MIN=60
MAX_RECORD_BYTES=2097152
ACCOUNT_QUOTA_BYTES=2147483648
MAX_PUSH_RECORDS=100
MAX_BODY_BYTES=25165824
MAX_BLOB_BYTES=33554432
BLOB_QUOTA_FLOOR_BYTES=65536
BLOB_UPLOAD_IDLE_TIMEOUT_S=30
PULL_LIMIT_DEFAULT=200
PULL_LIMIT_MAX=500
PULL_BYTE_BUDGET=8388608
DOORBELL_TICKET_TTL_S=30
WS_PING_INTERVAL_S=30
WS_IDLE_TIMEOUT_S=255
MAX_SOCKETS_PER_ACCOUNT=8
MAX_CONCURRENT_PER_USER=6
PROXY_IDLE_TIMEOUT_S=120
PROXY_MAX_BODY_BYTES=52428800
```

- [ ] **Step 2: Congruence self-check against the service examples**

Run:
```bash
for s in auth sync proxy; do
  echo "== $s =="; grep -oE '^[A-Z_]+=' apps/$s-service/.env.example | sort -u
done | sort -u > /tmp/svc-vars.txt
grep -oE '^[A-Z_]+=' deploy/deployment.env.template | sort -u > /tmp/tmpl-vars.txt
comm -23 /tmp/svc-vars.txt /tmp/tmpl-vars.txt
```
Expected: no service variable is missing from the template that a prod deploy needs. (`NODE_ENV`, `PORT`, `OPS_PORT`, `TEST_DATABASE_URL`, `DATABASE_URL`, `REDIS_URL` are set per-service in the compose, not here — note them as intentionally compose-set, not template-set.)

- [ ] **Step 3: Commit**

```bash
git add deploy/deployment.env.template
git commit -m "Add consolidated deployment.env template [skip ci]"
```

---

### Task 5: Compose template + prod Postgres init

**Files:**
- Create: `deploy/compose.template.yml`
- Create: `deploy/postgres-init/01-create-databases.sh`
- Reference: `infra/compose.prod.yml.example` (infra service definitions), `infra/postgres/init/01-create-databases.sh`

**Interfaces:**
- Consumes: variables from `deployment.env` (Task 4). The service `command:`s from Task 1.
- Produces: a compose the renderer trims. Traefik router names, hosts, ports as in Global Constraints.

- [ ] **Step 1: Write the prod Postgres init**

Create `deploy/postgres-init/01-create-databases.sh` (prod: auth_db + sync_db, no test DBs):

```bash
#!/usr/bin/env bash
# Runs on first Postgres start (empty data dir). Creates the two application
# databases owned by the app user. proxy-service is stateless (Redis only).
set -euo pipefail
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres <<-EOSQL
    SELECT 'CREATE DATABASE auth_db OWNER ${POSTGRES_USER}'
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'auth_db')\gexec
    SELECT 'CREATE DATABASE sync_db OWNER ${POSTGRES_USER}'
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'sync_db')\gexec
EOSQL
```

- [ ] **Step 2: Write the compose template**

Create `deploy/compose.template.yml`. Optional blocks are delimited by exact marker comments the renderer keys on: `# >>> MONITORING` … `# <<< MONITORING` and `# >>> WATCHTOWER` … `# <<< WATCHTOWER`.

```yaml
name: chatsundere

services:
  frontend:
    image: ghcr.io/symphonic-navigator/chatsundere-frontend:latest
    restart: unless-stopped
    labels:
      traefik.enable: 'true'
      traefik.docker.network: ${TRAEFIK_NETWORK}
      traefik.http.routers.cs-frontend.rule: Host(`${HOST_APP}`)
      traefik.http.routers.cs-frontend.entrypoints: websecure
      traefik.http.routers.cs-frontend.tls.certresolver: ${TRAEFIK_CERTRESOLVER}
      traefik.http.services.cs-frontend.loadbalancer.server.port: '80'
      com.centurylinklabs.watchtower.enable: 'true'
      com.centurylinklabs.watchtower.scope: chatsundere
    networks: [chatsundere, traefik]

  auth:
    image: ghcr.io/symphonic-navigator/chatsundere-backend:latest
    restart: unless-stopped
    # Migrate-then-serve: migrations are NOT run at boot by index.ts (verified —
    # a separate db:migrate script); running them in the command makes every
    # deploy/upgrade (incl. a Watchtower image pull) self-migrate idempotently.
    # cd into the service dir so drizzle's `migrationsFolder: './migrations'`
    # and the package script resolve; `exec` hands signals to the Bun process.
    command: ['sh', '-c', 'cd apps/auth-service && bun run db:migrate && exec bun src/index.ts']
    environment:
      NODE_ENV: production
      PORT: '3100'
      LOG_LEVEL: ${LOG_LEVEL}
      API_BASE_URL: ${API_BASE_URL}
      DATABASE_URL: postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/auth_db
      REDIS_URL: redis://redis:6379/0
      AUTH_JWT_PRIVATE_KEY: ${AUTH_JWT_PRIVATE_KEY}
      OPAQUE_SERVER_SETUP: ${OPAQUE_SERVER_SETUP}
      INVITATION_HMAC_KEY: ${INVITATION_HMAC_KEY}
      REFRESH_TOKEN_HMAC_KEY: ${REFRESH_TOKEN_HMAC_KEY}
      HMAC_KEY_PENDING_CODES: ${HMAC_KEY_PENDING_CODES}
      CORS_ALLOWED_ORIGINS: ${CORS_ALLOWED_ORIGINS}
      PROXY_PUBLIC_URL: ${PROXY_PUBLIC_URL}
      SYNC_PUBLIC_URL: ${SYNC_PUBLIC_URL}
      ADMIN_PUBLIC_URL: ${ADMIN_PUBLIC_URL}
      SYNC_BLOBS_ENABLED: ${SYNC_BLOBS_ENABLED}
    depends_on:
      postgres: {condition: service_healthy}
      redis: {condition: service_healthy}
    labels:
      traefik.enable: 'true'
      traefik.docker.network: ${TRAEFIK_NETWORK}
      traefik.http.routers.cs-auth.rule: Host(`${HOST_AUTH}`)
      traefik.http.routers.cs-auth.entrypoints: websecure
      traefik.http.routers.cs-auth.tls.certresolver: ${TRAEFIK_CERTRESOLVER}
      traefik.http.services.cs-auth.loadbalancer.server.port: '3100'
      com.centurylinklabs.watchtower.enable: 'true'
      com.centurylinklabs.watchtower.scope: chatsundere
    networks: [chatsundere, traefik]

  sync:
    image: ghcr.io/symphonic-navigator/chatsundere-backend:latest
    restart: unless-stopped
    # Migrate-then-serve (see auth). sync ALSO needs this: getInstanceEpoch reads
    # sync_meta at boot, a table a migration creates + seeds — without migrating
    # first the service refuses to boot.
    command: ['sh', '-c', 'cd apps/sync-service && bun run db:migrate && exec bun src/index.ts']
    environment:
      NODE_ENV: production
      PORT: '3200'
      OPS_PORT: '9091'
      LOG_LEVEL: ${LOG_LEVEL}
      DATABASE_URL: postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/sync_db
      REDIS_URL: redis://redis:6379/0
      JWT_ISSUER: ${JWT_ISSUER}
      JWT_AUDIENCE: ${JWT_AUDIENCE}
      AUTH_JWKS_URL: ${AUTH_JWKS_URL}
      CORS_ALLOWED_ORIGINS: ${CORS_ALLOWED_ORIGINS}
      TRUST_PROXY_HOPS: ${TRUST_PROXY_HOPS}
      RATE_LIMIT_USER_PER_MIN: ${RATE_LIMIT_USER_PER_MIN}
      RATE_LIMIT_IP_PER_MIN: ${RATE_LIMIT_IP_PER_MIN}
      RATE_LIMIT_DELETE_PER_MIN: ${RATE_LIMIT_DELETE_PER_MIN}
      MAX_RECORD_BYTES: ${MAX_RECORD_BYTES}
      ACCOUNT_QUOTA_BYTES: ${ACCOUNT_QUOTA_BYTES}
      MAX_PUSH_RECORDS: ${MAX_PUSH_RECORDS}
      MAX_BODY_BYTES: ${MAX_BODY_BYTES}
      MAX_BLOB_BYTES: ${MAX_BLOB_BYTES}
      BLOB_QUOTA_FLOOR_BYTES: ${BLOB_QUOTA_FLOOR_BYTES}
      BLOB_UPLOAD_IDLE_TIMEOUT_S: ${BLOB_UPLOAD_IDLE_TIMEOUT_S}
      PULL_LIMIT_DEFAULT: ${PULL_LIMIT_DEFAULT}
      PULL_LIMIT_MAX: ${PULL_LIMIT_MAX}
      PULL_BYTE_BUDGET: ${PULL_BYTE_BUDGET}
      DOORBELL_TICKET_TTL_S: ${DOORBELL_TICKET_TTL_S}
      WS_PING_INTERVAL_S: ${WS_PING_INTERVAL_S}
      WS_IDLE_TIMEOUT_S: ${WS_IDLE_TIMEOUT_S}
      MAX_SOCKETS_PER_ACCOUNT: ${MAX_SOCKETS_PER_ACCOUNT}
      S3_ENDPOINT: ${S3_ENDPOINT}
      S3_REGION: ${S3_REGION}
      S3_BUCKET: ${S3_BUCKET}
      S3_ACCESS_KEY_ID: ${S3_ACCESS_KEY_ID}
      S3_SECRET_ACCESS_KEY: ${S3_SECRET_ACCESS_KEY}
    depends_on:
      postgres: {condition: service_healthy}
      redis: {condition: service_healthy}
      minio: {condition: service_healthy}
    labels:
      traefik.enable: 'true'
      traefik.docker.network: ${TRAEFIK_NETWORK}
      traefik.http.routers.cs-sync.rule: Host(`${HOST_SYNC}`)
      traefik.http.routers.cs-sync.entrypoints: websecure
      traefik.http.routers.cs-sync.tls.certresolver: ${TRAEFIK_CERTRESOLVER}
      traefik.http.services.cs-sync.loadbalancer.server.port: '3200'
      com.centurylinklabs.watchtower.enable: 'true'
      com.centurylinklabs.watchtower.scope: chatsundere
    networks: [chatsundere, traefik]

  proxy:
    image: ghcr.io/symphonic-navigator/chatsundere-backend:latest
    restart: unless-stopped
    command: ['bun', 'apps/proxy-service/src/index.ts']
    environment:
      NODE_ENV: production
      PORT: '8080'
      OPS_PORT: '9090'
      LOG_LEVEL: ${LOG_LEVEL}
      REDIS_URL: redis://redis:6379/2
      JWT_ISSUER: ${JWT_ISSUER}
      JWT_AUDIENCE: ${JWT_AUDIENCE}
      AUTH_JWKS_URL: ${AUTH_JWKS_URL}
      CORS_ALLOWED_ORIGINS: ${CORS_ALLOWED_ORIGINS}
      TRUST_PROXY_HOPS: ${TRUST_PROXY_HOPS}
      RATE_LIMIT_USER_PER_MIN: ${RATE_LIMIT_USER_PER_MIN}
      RATE_LIMIT_IP_PER_MIN: ${RATE_LIMIT_IP_PER_MIN}
      MAX_BODY_BYTES: ${PROXY_MAX_BODY_BYTES}
      MAX_CONCURRENT_PER_USER: ${MAX_CONCURRENT_PER_USER}
      PROXY_IDLE_TIMEOUT_S: ${PROXY_IDLE_TIMEOUT_S}
    depends_on:
      redis: {condition: service_healthy}
    labels:
      traefik.enable: 'true'
      traefik.docker.network: ${TRAEFIK_NETWORK}
      traefik.http.routers.cs-proxy.rule: Host(`${HOST_PROXY}`)
      traefik.http.routers.cs-proxy.entrypoints: websecure
      traefik.http.routers.cs-proxy.tls.certresolver: ${TRAEFIK_CERTRESOLVER}
      traefik.http.services.cs-proxy.loadbalancer.server.port: '8080'
      com.centurylinklabs.watchtower.enable: 'true'
      com.centurylinklabs.watchtower.scope: chatsundere
    networks: [chatsundere, traefik]

  postgres:
    image: postgres:16-alpine
    restart: always
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: auth_db
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./postgres-init:/docker-entrypoint-initdb.d:ro
    healthcheck:
      test: ['CMD', 'pg_isready', '-U', '${POSTGRES_USER}', '-d', 'auth_db']
      interval: 10s
      timeout: 5s
      retries: 5
    networks: [chatsundere]

  redis:
    image: redis:7-alpine
    restart: always
    command: ['redis-server', '--appendonly', 'yes']
    volumes:
      - redis_data:/data
    healthcheck:
      test: ['CMD', 'redis-cli', 'ping']
      interval: 10s
      timeout: 3s
      retries: 5
    networks: [chatsundere]

  minio:
    image: minio/minio:RELEASE.2025-09-07T16-13-09Z
    restart: always
    command: ['server', '/data']
    environment:
      MINIO_ROOT_USER: ${MINIO_ROOT_USER:?set MINIO_ROOT_USER}
      MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD:?set MINIO_ROOT_PASSWORD}
    volumes:
      - minio_data:/data
    healthcheck:
      test: ['CMD', 'curl', '-f', 'http://localhost:9000/minio/health/live']
      interval: 10s
      timeout: 5s
      retries: 5
    networks: [chatsundere]

  # >>> MONITORING
  prometheus:
    image: prom/prometheus:latest
    restart: always
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.path=/prometheus'
    volumes:
      - prometheus_data:/prometheus
      - ./prometheus/prometheus.yml:/etc/prometheus/prometheus.yml:ro
    labels:
      traefik.enable: 'true'
      traefik.docker.network: ${TRAEFIK_NETWORK}
      traefik.http.routers.cs-prometheus.rule: Host(`${HOST_PROMETHEUS}`)
      traefik.http.routers.cs-prometheus.entrypoints: websecure
      traefik.http.routers.cs-prometheus.tls.certresolver: ${TRAEFIK_CERTRESOLVER}
      traefik.http.routers.cs-prometheus.middlewares: cs-prometheus-auth
      traefik.http.middlewares.cs-prometheus-auth.basicauth.users: ${TRAEFIK_AUTH_USERS}
      traefik.http.services.cs-prometheus.loadbalancer.server.port: '9090'
    networks: [chatsundere, traefik]

  grafana:
    image: grafana/grafana:latest
    restart: always
    environment:
      GF_SECURITY_ADMIN_USER: ${GRAFANA_ADMIN_USER}
      GF_SECURITY_ADMIN_PASSWORD: ${GRAFANA_ADMIN_PASSWORD}
      GF_USERS_ALLOW_SIGN_UP: 'false'
      GF_SERVER_ROOT_URL: https://${HOST_GRAFANA}
    volumes:
      - grafana_data:/var/lib/grafana
    depends_on:
      prometheus: {condition: service_started}
    labels:
      traefik.enable: 'true'
      traefik.docker.network: ${TRAEFIK_NETWORK}
      traefik.http.routers.cs-grafana.rule: Host(`${HOST_GRAFANA}`)
      traefik.http.routers.cs-grafana.entrypoints: websecure
      traefik.http.routers.cs-grafana.tls.certresolver: ${TRAEFIK_CERTRESOLVER}
      traefik.http.services.cs-grafana.loadbalancer.server.port: '3000'
    networks: [chatsundere, traefik]
  # <<< MONITORING

  # >>> WATCHTOWER
  watchtower:
    image: containrrr/watchtower
    restart: unless-stopped
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    environment:
      WATCHTOWER_SCOPE: chatsundere
      WATCHTOWER_LABEL_ENABLE: 'true'
      WATCHTOWER_CLEANUP: 'true'
      WATCHTOWER_POLL_INTERVAL: '300'
    labels:
      com.centurylinklabs.watchtower.scope: chatsundere
    networks: [chatsundere]
  # <<< WATCHTOWER

volumes:
  postgres_data:
  redis_data:
  minio_data:
  prometheus_data:
  grafana_data:

networks:
  chatsundere:
    driver: bridge
  traefik:
    external: true
    name: ${TRAEFIK_NETWORK}
```

- [ ] **Step 3: Verify the template parses with a throwaway env (monitoring included)**

Run:
```bash
cd deploy
cp deployment.env.template /tmp/test.env
# fill placeholders enough to interpolate:
sed -i 's/CHANGE-ME-[A-Z-]*/x/g' /tmp/test.env
cp compose.template.yml /tmp/docker-compose.yml
mkdir -p /tmp/prometheus && echo '{}' > /tmp/prometheus/prometheus.yml
( cd /tmp && docker compose --env-file test.env -f docker-compose.yml config >/dev/null && echo PARSES )
cd ..
```
Expected: `PARSES`. (The `traefik` external network `name:` interpolates from `TRAEFIK_NETWORK`; compose does not require the network to exist for `config`.)

- [ ] **Step 4: Commit**

```bash
git add deploy/compose.template.yml deploy/postgres-init/01-create-databases.sh
git commit -m "Add unified compose template and prod Postgres init"
```

---

### Task 6: `generate.sh` (Script A — local)

**Files:**
- Create: `deploy/generate.sh`

**Interfaces:**
- Consumes: `deployment.env.template`, `compose.template.yml`, `postgres-init/`.
- Produces: `out/deployment.env` (random secrets filled, OPAQUE/S3 empty), `out/docker-compose.yml` (optional blocks trimmed), `out/postgres-init/`, `out/prometheus/` (when monitoring on).

- [ ] **Step 1: Write the script**

Create `deploy/generate.sh`:

```bash
#!/usr/bin/env bash
# Script A — local generator. Depends only on: bash, openssl, sed, awk.
# Prompts for domain + options, mints all random secrets, renders the compose.
# OPAQUE_SERVER_SETUP and the MinIO scoped key are filled later by install.sh.
set -euo pipefail
cd "$(dirname "$0")"

b64url32() { openssl rand 32 | basenc --base64url | tr -d '='; }
pw() { openssl rand -base64 24 | tr -d '/+='; }

echo "Chatsundere deployment generator"
read -rp "Base domain (e.g. chatsundere.me): " BASE_DOMAIN
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
declare -A V=(
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
  [TRAEFIK_AUTH_USERS]="admin:$(openssl passwd -apr1 "$MON_PW")"
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
awk -v mon="$MON" -v wt="$WT" '
  /# >>> MONITORING/ { skip = (mon ~ /^[Yy]/) ? 0 : 1; if (skip) next; else next }
  /# <<< MONITORING/ { skip = 0; next }
  /# >>> WATCHTOWER/ { skipw = (wt ~ /^[Nn]/) ? 1 : 0; if (skipw) next; else next }
  /# <<< WATCHTOWER/ { skipw = 0; next }
  { if (!skip && !skipw) print }
' compose.template.yml > out/docker-compose.yml

if [[ "$MON" =~ ^[Yy] ]]; then
  mkdir -p out/prometheus
  cp ../infra/prometheus/prometheus.yml out/prometheus/ 2>/dev/null || echo '# add scrape targets' > out/prometheus/prometheus.yml
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
```

**Note for the implementer:** the render is pure `bash`+`openssl`+`sed` (no
python) — an associative array of computed values, then a line-by-line rewrite of
the template replacing only keys present in the array. The apr1 hash lands in the
env file as `admin:<hash>` verbatim: `$` is doubled only when a value sits inside
a compose *file*, never inside an env file, so the raw apr1 hash is correct here.
Requires `bash` ≥ 4 for the associative array (fine on any modern Linux/macOS with
Homebrew bash; note it in the README if targeting stock macOS `/bin/bash` 3.2).
Validate the result parses in Step 2.

- [ ] **Step 2: Run it non-interactively and inspect the output**

Run:
```bash
cd deploy
printf 'test.example\n\n\nn\nY\nn\n' | bash generate.sh
grep -E 'AUTH_JWT_PRIVATE_KEY|HMAC|OPAQUE_SERVER_SETUP|S3_ACCESS_KEY_ID' out/deployment.env
awk '/prometheus:/{print "HAS_PROM"} /watchtower:/{print "HAS_WT"}' out/docker-compose.yml
( cd out && cp -r ../../infra/prometheus . 2>/dev/null; docker compose --env-file deployment.env config >/dev/null && echo PARSES )
cd ..
```
Expected: the HMAC/JWT keys are filled with non-empty base64url; `OPAQUE_SERVER_SETUP` and `S3_ACCESS_KEY_ID` are still the `CHANGE-ME-ON-SERVER` placeholder; `HAS_WT` prints but `HAS_PROM` does not (monitoring declined); `PARSES` prints; `out/deployment.env` mode is `600` (`stat -c '%a' out/deployment.env`).

- [ ] **Step 3: shellcheck**

Run: `shellcheck deploy/generate.sh deploy/postgres-init/01-create-databases.sh`
Expected: no errors (warnings acceptable if justified inline with `# shellcheck disable=`).

- [ ] **Step 4: Commit**

```bash
git add deploy/generate.sh
git commit -m "Add local deployment generator (secrets + compose rendering)"
```

---

### Task 7: `install.sh` (Script B — server)

**Files:**
- Create: `deploy/install.sh`

**Interfaces:**
- Consumes: `out/docker-compose.yml`, `out/deployment.env`, `out/postgres-init/`. The backend image CLIs and `mc`.
- Produces: a running stack; `deployment.env` gains `OPAQUE_SERVER_SETUP` + the MinIO scoped key; the first admin + first invitation.

- [ ] **Step 1: Write the script**

Create `deploy/install.sh`:

```bash
#!/usr/bin/env bash
# Script B — server installer. Idempotent: safe to re-run. Fills the
# generate-once secrets (OPAQUE, MinIO scoped key) only when still empty.
set -euo pipefail
cd "$(dirname "$0")"

ENV_FILE=deployment.env
COMPOSE="docker compose --env-file $ENV_FILE -f docker-compose.yml"
BACKEND_IMAGE=ghcr.io/symphonic-navigator/chatsundere-backend:latest

need() { command -v "$1" >/dev/null || { echo "Missing: $1"; exit 1; }; }
need docker
get() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2-; }
set_kv() { # set_kv KEY VALUE — replace the line in-place
  local k=$1 v=$2
  if grep -qE "^$k=" "$ENV_FILE"; then
    awk -v k="$k" -v v="$v" 'BEGIN{FS=OFS="="} $1==k{$0=k"="v} {print}' "$ENV_FILE" > "$ENV_FILE.tmp"
    mv "$ENV_FILE.tmp" "$ENV_FILE"
  else
    echo "$k=$v" >> "$ENV_FILE"
  fi
  chmod 600 "$ENV_FILE"
}

TRAEFIK_NETWORK=$(get TRAEFIK_NETWORK)
echo "== Preflight =="
$COMPOSE config >/dev/null && echo "compose OK"
if ! docker network inspect "$TRAEFIK_NETWORK" >/dev/null 2>&1; then
  echo "Traefik network '$TRAEFIK_NETWORK' not found."
  echo "Create it (docker network create $TRAEFIK_NETWORK) or point TRAEFIK_NETWORK at your existing one."
  exit 1
fi

echo "== Bring up data services =="
$COMPOSE up -d postgres redis minio
for s in postgres redis minio; do
  echo -n "waiting for $s "
  until [ "$($COMPOSE ps -q $s | xargs docker inspect -f '{{.State.Health.Status}}')" = healthy ]; do
    echo -n .; sleep 2; done; echo " healthy"
done

echo "== MinIO bucket + scoped key =="
if [ "$(get S3_ACCESS_KEY_ID)" = "CHANGE-ME-ON-SERVER" ]; then
  ROOT_U=$(get MINIO_ROOT_USER); ROOT_P=$(get MINIO_ROOT_PASSWORD)
  BUCKET=$(get S3_BUCKET)
  POLICY='{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":["s3:*"],"Resource":["arn:aws:s3:::'"$BUCKET"'","arn:aws:s3:::'"$BUCKET"'/*"]}]}'
  OUT=$(docker run --rm --network "$(basename "$PWD")_chatsundere" --entrypoint sh minio/mc -c '
    set -e
    mc alias set m http://minio:9000 '"$ROOT_U"' '"$ROOT_P"' >/dev/null
    mc mb --ignore-existing m/'"$BUCKET"' >/dev/null
    mc version disable m/'"$BUCKET"' >/dev/null 2>&1 || true
    printf "%s" '"'$POLICY'"' > /tmp/p.json
    mc admin user svcacct add --json --policy /tmp/p.json m '"$ROOT_U"'
  ')
  AK=$(printf '%s' "$OUT" | grep -oE '"accessKey"[^,]*' | cut -d'"' -f4)
  SK=$(printf '%s' "$OUT" | grep -oE '"secretKey"[^,]*' | cut -d'"' -f4)
  [ -n "$AK" ] && [ -n "$SK" ] || { echo "mc svcacct add failed:"; echo "$OUT"; exit 1; }
  set_kv S3_ACCESS_KEY_ID "$AK"; set_kv S3_SECRET_ACCESS_KEY "$SK"
  echo "scoped key created"
else
  echo "scoped key already present — skipping"
fi

echo "== OPAQUE server setup (generate once) =="
if [ "$(get OPAQUE_SERVER_SETUP)" = "CHANGE-ME-ON-SERVER" ]; then
  SETUP=$(docker run --rm "$BACKEND_IMAGE" bun run --cwd apps/auth-service generate-opaque-setup | tr -d '\r\n')
  [ -n "$SETUP" ] || { echo "OPAQUE generation produced no output"; exit 1; }
  set_kv OPAQUE_SERVER_SETUP "$SETUP"
  echo "OPAQUE_SERVER_SETUP generated — BACK UP deployment.env NOW; never rotate this value."
else
  echo "OPAQUE already set — skipping (rotating it would brick every account)"
fi

echo "== Bring up application services =="
# auth + sync migrate-then-serve via their compose command (idempotent), so no
# separate migration step is needed here; the /readyz wait below tolerates the
# one-off migrate delay on first boot.
$COMPOSE up -d auth sync proxy frontend
# monitoring/watchtower come up too if present in the compose:
$COMPOSE up -d

echo "== Wait for /readyz =="
for s in auth:3100 sync:9091 proxy:9090; do
  name=${s%%:*}; port=${s##*:}
  echo -n "waiting for $name "
  until $COMPOSE exec -T "$name" sh -c "wget -qO- http://localhost:$port/readyz >/dev/null 2>&1 || curl -fsS http://localhost:$port/readyz >/dev/null 2>&1"; do
    echo -n .; sleep 2; done; echo " ready"
done

echo "== Bootstrap the first admin =="
$COMPOSE exec auth bun run bootstrap-admin

echo
echo "Done. Public URLs:"
echo "  app:   https://$(get HOST_APP)   (admin at /admin/)"
echo "  auth:  https://$(get HOST_AUTH)   config: /api/v1/config"
echo "  sync:  https://$(get HOST_SYNC)"
echo "  proxy: https://$(get HOST_PROXY)"
```

**Notes for the implementer:**
- The MinIO `docker run` network is `<project>_chatsundere`; the compose `name:`
  is `chatsundere`, so the network is `chatsundere_chatsundere`. Verify the
  actual name on the dev stack (`docker network ls | grep chatsundere`) and pin
  it — do not trust `basename "$PWD"`. Prefer `$COMPOSE run --rm` with a
  throwaway `mc` service on the compose network if that is cleaner.
- Validate the `mc admin user svcacct add --policy` invocation against a **real**
  dev MinIO (spin `infra/compose.dev.yml`'s minio) — the exact flag names and
  JSON output keys (`accessKey`/`secretKey`) are the one live-verified unknown
  from the spec's §11.
- `bootstrap-admin` is interactive (prompts for a username); `-T` is omitted for
  that exec so the TTY attaches.

- [ ] **Step 2: shellcheck**

Run: `shellcheck deploy/install.sh`
Expected: no errors.

- [ ] **Step 3: Idempotency dry-check (logic only, no full stack)**

Run:
```bash
cd deploy
cp out/deployment.env /tmp/env.test
# simulate a filled OPAQUE + key:
sed -i 's/^OPAQUE_SERVER_SETUP=.*/OPAQUE_SERVER_SETUP=already-set/' /tmp/env.test
sed -i 's/^S3_ACCESS_KEY_ID=.*/S3_ACCESS_KEY_ID=already-set/' /tmp/env.test
grep -E '^(OPAQUE_SERVER_SETUP|S3_ACCESS_KEY_ID)=' /tmp/env.test
cd ..
```
Expected: both show `already-set` — confirming the `= "CHANGE-ME-ON-SERVER"` guards in the script will skip regeneration. (Full run is Chris's VPS manual verification, §10 of the spec.)

- [ ] **Step 4: Live MinIO `mc` check against the dev stack**

Run:
```bash
docker compose -f infra/compose.dev.yml up -d minio
docker run --rm --network chatsundere-dev_chatsundere-dev --entrypoint sh minio/mc -c '
  mc alias set m http://minio:9000 chatsundere-dev chatsundere-dev-secret
  mc mb --ignore-existing m/chatsundere-blobs
  printf "%s" "{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Action\":[\"s3:*\"],\"Resource\":[\"arn:aws:s3:::chatsundere-blobs\",\"arn:aws:s3:::chatsundere-blobs/*\"]}]}" > /tmp/p.json
  mc admin user svcacct add --json --policy /tmp/p.json m chatsundere-dev
'
docker compose -f infra/compose.dev.yml down
```
Expected: the last command prints JSON containing `accessKey` and `secretKey`. If the flag names differ on the pinned `mc`, correct the script and re-run. This validates spec §11's live unknown.

- [ ] **Step 5: Commit**

```bash
git add deploy/install.sh
git commit -m "Add server installer (MinIO scoped key, OPAQUE, bring-up, bootstrap)"
```

---

### Task 8: README, doc congruence, retire the old example

**Files:**
- Create: `deploy/README.md`
- Modify: `obsidian/DEPLOYMENT.md` (chapters 4–6; fix proxy-port row)
- Delete: `infra/compose.prod.yml.example`

- [ ] **Step 1: Write `deploy/README.md`**

Create `deploy/README.md`:

```markdown
# Deploying Chatsundere

A two-phase, secret-generating installer for the full stack behind an existing
Traefik. Full operator reference: `../obsidian/DEPLOYMENT.md`.

## Prerequisites

- A host with Docker + Docker Compose and an **existing Traefik** on an external
  docker network (default name `traefik`), terminating TLS on `websecure`.
- DNS A/AAAA records for `app.`, `auth.`, `sync.`, `proxy.` (and, if you enable
  monitoring, `prometheus.`, `grafana.`) under your base domain, pointing at the
  host.
- Locally: `bash` + `openssl`.

## 1. Generate (local)

```bash
cd deploy
./generate.sh          # answers: base domain, Traefik network, monitoring y/N
```

This writes `out/` with `deployment.env` (random secrets filled),
`docker-compose.yml`, `postgres-init/`, and `install.sh`.

## 2. Ship + install (server)

```bash
scp -r out/ user@your-vps:/opt/chatsundere
ssh user@your-vps 'cd /opt/chatsundere && ./install.sh'
```

`install.sh` brings up Postgres/Redis/MinIO, creates the MinIO bucket + a
bucket-scoped access key, generates the OPAQUE server setup **once**, starts the
services (migrations run on boot), and bootstraps your first admin.

## 3. After first boot

- **Back up `deployment.env`** — it now holds `OPAQUE_SERVER_SETUP` and the
  HMAC/JWT keys. Losing them is unrecoverable; rotating OPAQUE bricks every
  account's passphrase auth.
- Point a client at `https://app.<your-domain>`; the admin console is at
  `https://app.<your-domain>/admin/`.

See `../obsidian/DEPLOYMENT.md` for operations, backups/restore (the epoch-flip
runbook), scaling honesty, and the security checklist.
```

- [ ] **Step 2: Rewrite DEPLOYMENT.md chapters 5–6 to the generator flow**

In `obsidian/DEPLOYMENT.md`: replace chapter 5 ("Compose walkthrough" — the
hand-copy of `compose.prod.yml.example`) and chapter 6 ("Bootstrap" — the manual
`docker compose up` sequence + manual MinIO hand-step) with a description of the
`deploy/generate.sh` → scp → `deploy/install.sh` flow. Keep chapter 4's variable
tables (they remain the source of truth) and **add** the new template-level
variables (`BASE_DOMAIN`, `HOST_*`, `TRAEFIK_NETWORK`, `TRAEFIK_CERTRESOLVER`).
State that the MinIO scoped-key hand-step and the OPAQUE generation are now
automated by `install.sh` (idempotently). Cross-reference `deploy/README.md`.
**Also correct the migration claim:** chapter 6 (and any other spot) currently
says "Migrations run on boot (Drizzle)". They do NOT — `index.ts` runs no
migrator. auth + sync now **migrate-then-serve in their compose command**
(`cd apps/<svc>-service && bun run db:migrate && exec bun src/index.ts`), so a
deploy or a Watchtower image pull self-migrates idempotently. Update the wording
to say so, and note that upgrades therefore need no manual migration step.
Run `grep -ni "migrations run on boot\|on boot (Drizzle)" obsidian/DEPLOYMENT.md`
and fix every hit.

- [ ] **Step 3: Fix the proxy-port discrepancy**

In `obsidian/DEPLOYMENT.md` §4.3, change the proxy `PORT` from `3300` to `8080`
(verified: `apps/proxy-service/src/env.ts` defaults `PORT` to `8080`, `OPS_PORT`
to `9090`).

Run: `grep -n "3300" obsidian/DEPLOYMENT.md`
Expected: no matches after the edit.

- [ ] **Step 4: Retire the superseded example**

Run:
```bash
git rm infra/compose.prod.yml.example
grep -rn "compose.prod.yml.example" obsidian/ deploy/ README.md 2>/dev/null
```
Expected: the file is removed; fix any lingering reference the grep surfaces (point it at `deploy/`).

- [ ] **Step 5: Commit**

```bash
git add deploy/README.md obsidian/DEPLOYMENT.md
git commit -m "Document the generator deploy flow; retire the hand-copy compose example [skip ci]"
```

**End of Unit 2.** Summon **Larissa** with the absolute worktree paths (secret
generation, MinIO scoping, network exposure per spec §7). Fix findings, then this
is the second squash unit ("Add self-hosted deployment kit and update deployment
docs"). Then Chris runs the spec §10 manual verification on a VPS staging
directory before the real go-live.

---

## Self-Review notes

- **Spec §4 (Unit 1)** → Tasks 1–3. **Spec §5 (Unit 2)** → Tasks 4–8. **Spec §6
  (doc congruence)** → Task 8. **Spec §7 (Larissa gate)** → end of Unit 2.
  **Spec §8 (testing)** → the verify steps (config parse, image build, `/admin/`
  curl, shellcheck, live `mc`). **Spec §10 (manual verification)** → owned by
  Chris post-merge.
- **Spec §11 open questions** are resolved in-plan: proxy port → 8080 (Task 8
  Step 3); MinIO `mc` mechanics → `install.sh`-driven, live-verified in Task 7
  Steps 4; frontend cut-over timing → Chris's operational call (spec §10 step 7).
- **`generate.sh` dependency note:** the env render is pure `bash`+`openssl`+`sed`
  (associative array + line rewrite), keeping the local phase dependency-light;
  the apr1 hash lands as `admin:<hash>` in the env file. Requires `bash` ≥ 4
  (note in the README for stock-macOS users). Validated via Task 6 Step 2's
  `docker compose config` parse.
```
