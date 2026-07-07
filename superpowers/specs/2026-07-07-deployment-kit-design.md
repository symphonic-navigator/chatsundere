# Deployment kit — self-hosted Chatsundere via Traefik

**Date:** 2026-07-07
**Author:** Liz (with Chris)
**Status:** Design — awaiting review
**Related:** [[../../obsidian/DEPLOYMENT.md]], `infra/compose.prod.yml.example`,
`apps/user-client/Dockerfile`, `.github/workflows/docker.yml`, the three service
`.env.example` files. Roadmap: Block 6 → **v0.2.0** first backend go-live.

---

## 1. Purpose

The whole backend (auth + sync + proxy + Postgres + Redis + MinIO) is built,
merged and audited but has **never been deployed**. This kit makes the first
deploy real — for Chris on his Hetzner VPS, and for any third-party self-hoster
(AGPLv3; deredere towards operators too). It delivers:

1. A **backend container image** (one image, all three Bun services) plus its CI
   job, mirroring the existing frontend image.
2. The admin-client **baked into the frontend image** under `/admin/` so the
   already-shipped "Admin" tile works in production (same-origin requirement).
3. A **unified compose template** covering the entire stack behind an existing
   Traefik.
4. A **two-phase, secret-generating install flow** (`generate.sh` local,
   `install.sh` on the server) that turns "clone the repo, answer a few
   questions, scp, run one script" into a working instance.

**Non-goals.** Bundling Traefik (an existing Traefik is assumed). Kubernetes or
multi-host scaling (chapter 8 of DEPLOYMENT.md already sets that expectation).
Rotating any "generate once" secret. A CI job that auto-deploys (Watchtower on a
conscious `v*.*.*` tag remains the release mechanism).

---

## 2. Decisions settled with Chris (2026-07-07)

- **One backend image, three services** selected by `command:` — one build, one
  pull, one tag to version.
- **Existing Traefik assumed** — the kit joins an external Traefik network (name
  configurable, default `traefik`); only Traefik binds host ports 80/443.
- **MinIO scoped key automated** via a one-shot `minio-init` (`mc`) service — no
  manual hand-step; the sync-service receives the scoped key, never root.
- **Two-phase flow** — `generate.sh` (local, `openssl`-only) → scp → `install.sh`
  (server) brings the stack up and bootstraps the first admin.
- **Unified compose** — the frontend folds into the same stack (one file, whole
  system) rather than staying a separate compose.
- **OPAQUE generated on the server**, once, by `install.sh` (idempotent: only if
  empty), keeping `generate.sh` dependency-light.
- **Admin baked into the frontend image** under `/admin/` (same-origin, no extra
  service, no extra Traefik route).

---

## 3. Architecture overview

```
                          ┌─────────── Traefik (existing, external network) ───────────┐
   Browser ──443──▶ app.<base>            auth.<base>       sync.<base>     proxy.<base>
                        │                     │                 │               │
                   ┌────▼────┐          ┌─────▼─────┐    ┌──────▼─────┐  ┌──────▼─────┐
                   │frontend │          │  auth      │   │   sync      │ │   proxy     │
                   │ nginx   │          │ (backend   │   │ (backend    │ │ (backend    │
                   │ + /admin│          │  image)    │   │  image)     │ │  image)     │
                   └─────────┘          └─────┬──────┘   └──────┬──────┘ └──────┬──────┘
                                              │                 │               │
                            ┌─────────────────┼─────────────────┼───────────────┘
                            │                 │                 │
                       ┌────▼────┐      ┌──────▼─────┐    ┌──────▼─────┐
                       │postgres │      │   redis     │   │   minio     │  (internal
                       └─────────┘      └────────────┘    └────────────┘   network only)
                                                          ▲
                                    install.sh runs mc once: bucket + scoped key
   optional: prometheus / grafana (own subdomains, basic-auth)   +   scoped watchtower
```

All service-to-service traffic and Postgres/Redis/MinIO stay on the internal
`chatsundere` bridge network; the four public services additionally join the
external `traefik` network. Ports of the app services are internal only — Traefik
addresses them by container port.

---

## 4. Unit 1 — Backend image, admin-in-frontend, CI

### 4.1 `apps/backend/Dockerfile` (new)

Multi-stage, monorepo-aware (build context = repo root), mirroring the frontend
Dockerfile's layer ordering:

- **Builder** on `oven/bun:1-alpine` (pin the concrete Bun minor already used in
  the lockfile). Copy manifests first → `bun install --frozen-lockfile`; then
  copy `packages/` and `apps/{auth,sync,proxy}-service` and build the workspace
  packages the services consume. Bun runs TypeScript directly, so a `bun build`
  bundle step is optional — either bundle each service's `src/index.ts` to
  `dist/`, or run source directly. **Decision:** run source directly at runtime
  (`bun apps/<svc>-service/src/index.ts`) to keep migrations/CLI entrypoints
  (`bootstrap-admin`, `generate-opaque-setup`, `re-epoch`, `db:migrate`)
  trivially reachable in the same image; a bundle would fragment those.
- **Runtime** on `oven/bun:1-alpine`, non-root user, carrying the installed
  `node_modules`, built `packages/*/dist`, and the three services' source. No
  default `command:` — the compose sets it per service. `EXPOSE` is documentary
  only; the compose maps nothing (internal network).
- Build args `VERSION` / `GIT_SHA` / `BUILT_AT` written to a `/VERSION` marker for
  parity with the frontend.

The image must contain everything the operator runbooks invoke:
`bun run --cwd apps/auth-service generate-opaque-setup`, `… bootstrap-admin`,
`bun apps/sync-service/tools/re-epoch.ts`. Verify each is reachable from the
runtime image (they need the built packages + node_modules present, which they
are).

### 4.2 Frontend image gains `/admin/`

Extend `apps/user-client/Dockerfile`: build `apps/admin-client` (its Vite `base`
is already `/admin/`) and copy its `dist` into
`/usr/share/nginx/html/admin/`. Add to `nginx.conf` a location:

```nginx
location /admin/ {
    try_files $uri $uri/ /admin/index.html;
    # repeat the three isolation headers (add_header does not inherit)
}
```

The admin build is a normal SPA; it needs the same COOP/COEP/CORP headers as the
root app (repeated per nginx's non-inheritance rule). No separate origin, so it
sees the user-client's IndexedDB account. `ADMIN_PUBLIC_URL` in auth-service env
therefore points at `https://app.<base>/admin/`.

### 4.3 CI (`docker.yml`)

Add a `build-backend` job alongside `build-frontend`: same checkout/buildx/login/
cosign steps, `context: .`, `file: apps/backend/Dockerfile`,
`images: ghcr.io/symphonic-navigator/chatsundere-backend`, identical tag rules
(`type=raw,value=latest,enable=${{ startsWith(github.ref, 'refs/tags/v') }}`),
`cache-*: scope=backend`. The two jobs run in parallel; both must be green for a
release tag to move `:latest` on both images.

---

## 5. Unit 2 — Deploy kit (`deploy/`)

New top-level `deploy/` directory (discoverable for cloners; the compose example
in `infra/` is superseded and removed):

```
deploy/
├── compose.template.yml      # rendered → docker-compose.yml
├── deployment.env.template    # documented, placeholder-only
├── generate.sh                # Script A (local)
├── install.sh                 # Script B (server)
└── README.md                  # quickstart + pointer to obsidian/DEPLOYMENT.md
```

### 5.1 `compose.template.yml`

`name: chatsundere`. Services:

| Service | Image | Notes |
|---|---|---|
| `frontend` | `…/chatsundere-frontend:latest` | Traefik `app.<base>`; serves `/admin/` too |
| `auth` | `…/chatsundere-backend:latest` | `command: bun apps/auth-service/src/index.ts`; Traefik `auth.<base>` |
| `sync` | `…/chatsundere-backend:latest` | `command: bun apps/sync-service/src/index.ts`; Traefik `sync.<base>`; OPS port never routed |
| `proxy` | `…/chatsundere-backend:latest` | `command: bun apps/proxy-service/src/index.ts`; Traefik `proxy.<base>`; OPS port never routed |
| `postgres` | `postgres:16-alpine` | internal only; `POSTGRES_DB` seeds `auth_db`; `init/` creates `sync_db` (+ `_test` skipped in prod) |
| `redis` | `redis:7-alpine` | internal only; shared by auth/sync/proxy (deny-list) |
| `minio` | pinned release | internal only; `:?`-guarded root creds |
| `prometheus` / `grafana` | latest | **optional block** — rendered in only when monitoring chosen |
| `watchtower` | `containrrr/watchtower` | scoped (`scope=chatsundere`), coexists with any host Watchtower |

- **Env-driven variance.** All hostnames, the Traefik network name, ports, CORS
  origins and every secret flow via `deployment.env` and Compose `${VAR}`
  interpolation (including inside Traefik router labels). `generate.sh` only
  *renders* what env cannot express: the include/exclude of the optional
  monitoring + watchtower blocks.
- **`minio-init`** uses the MinIO root credential (from env) to create the
  `chatsundere-blobs` bucket and a scoped access key limited to that bucket's
  CRUD, writes the scoped key into a shared location the sync-service reads, and
  ensures object versioning/ILM stay OFF (versioning would defeat the deletion
  promise). It runs once and exits 0; the sync-service `depends_on` it.
  - **Open implementation point (resolve in the plan):** `mc admin user svcacct
    add` mints a scoped service account, but its key/secret are emitted to
    stdout, not into env. Cleanest realisation: `minio-init` writes the scoped
    credentials to a small file on a shared volume that the sync-service reads at
    boot, OR `install.sh` performs the `mc` step and injects the resulting scoped
    key into `deployment.env` before starting `sync`. The latter keeps the
    contract "sync-service reads S3_* from env" unchanged and avoids a new
    file-read code path — **preferred**; `minio-init` then becomes a step inside
    `install.sh` rather than a compose service. Confirmed direction is the
    `install.sh`-driven `mc` step (see §5.3).
- **Blobs congruence:** the template sets sync `S3_ENDPOINT=http://minio:9000`
  and auth `SYNC_BLOBS_ENABLED=true` together (DEPLOYMENT §4.4 checkpoint).

### 5.2 `deployment.env.template`

One flat, richly-commented env file consolidating every operator-facing variable
across the three services + infra, grouped by concern. Placeholders only —
`CHANGE-ME` tripwires for secrets, real defaults for tunables. Chapters:

- **Domains** — `BASE_DOMAIN`, derived `HOST_APP` / `HOST_AUTH` / `HOST_SYNC` /
  `HOST_PROXY` (+ optional `HOST_PROMETHEUS` / `HOST_GRAFANA`), `TRAEFIK_NETWORK`.
- **Secrets (generated)** — `POSTGRES_PASSWORD`, `MINIO_ROOT_USER/PASSWORD`,
  `GRAFANA_ADMIN_PASSWORD`, `TRAEFIK_AUTH_USERS` (htpasswd), `AUTH_JWT_PRIVATE_KEY`,
  `INVITATION_HMAC_KEY`, `REFRESH_TOKEN_HMAC_KEY`, `HMAC_KEY_PENDING_CODES`,
  `OPAQUE_SERVER_SETUP` (filled by `install.sh`), the MinIO scoped
  `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` (filled by `install.sh`).
- **Tunables** — rate limits, quotas, body caps, TTLs — carried through with the
  `.env.example` defaults so an operator rarely touches them.

The template stays **congruent** with the service `.env.example` files (the same
self-check DEPLOYMENT §4 mandates: every documented var exists in an example).

### 5.3 `generate.sh` (Script A — local, `openssl`-only)

Interactive, POSIX-portable bash. Steps:

1. Prompt: base domain; Traefik network name (default `traefik`); enable
   monitoring? (y/N); CORS origin (default `https://app.<base>`); optional
   per-host overrides (advanced).
2. Generate all pure-random secrets with `openssl`:
   - passwords: `openssl rand -base64 24 | tr -d '/+='`-style;
   - base64url HMAC keys + the 32-byte EdDSA `AUTH_JWT_PRIVATE_KEY`:
     `openssl rand 32 | basenc --base64url | tr -d '='` (the `.env.example`
     defines the JWT key as 32 raw random bytes base64url — no service code
     needed);
   - `TRAEFIK_AUTH_USERS` via `openssl passwd -apr1` (htpasswd apr1), printing the
     chosen monitoring password once.
3. Write `out/deployment.env` from the template with values filled and
   `OPAQUE_SERVER_SETUP` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` left empty
   (a comment says `install.sh` fills them).
4. Render `out/docker-compose.yml` from `compose.template.yml`, including/excluding
   the monitoring + watchtower blocks per the answers.
5. Print the next steps: `scp -r out/ user@vps:/opt/chatsundere` then
   `ssh … 'cd /opt/chatsundere && ./install.sh'`, and a **loud reminder** to back
   up `deployment.env` (it will hold irreplaceable "generate once" secrets after
   `install.sh` runs).

`generate.sh` never needs Docker or Bun — only `openssl` + coreutils.

### 5.4 `install.sh` (Script B — server)

Idempotent, safe to re-run. Steps:

1. Preflight: Docker + compose present; external Traefik network exists (create-or-
   instruct); `deployment.env` present; `docker compose config` parses.
2. `docker compose up -d postgres redis minio`; wait for all three healthchecks
   green.
3. **MinIO bucket + scoped key** (the automated hand-step): run `mc` (via
   `docker run --rm minio/mc` or a transient service) against the root credential
   to create `chatsundere-blobs`, mint a bucket-scoped access key, ensure
   versioning OFF, and — if `S3_ACCESS_KEY_ID` is empty in `deployment.env` —
   write the scoped key/secret back into `deployment.env`. Idempotent (skip if the
   key line is already filled).
4. **OPAQUE**: if `OPAQUE_SERVER_SETUP` is empty, run
   `docker run --rm --env-file deployment.env …/chatsundere-backend
   bun run --cwd apps/auth-service generate-opaque-setup`, capture stdout, write
   it into `deployment.env`. Idempotent; a filled value is never overwritten
   (rotating it bricks every account's passphrase auth). Print the
   "back-this-up-now, never rotate" warning.
5. `docker compose up -d auth sync proxy frontend` (+ monitoring if present).
   auth + sync **migrate-then-serve in their compose command** (`bun run
   db:migrate && exec bun src/index.ts`) — migrations are NOT run by `index.ts`,
   so the command carries them, idempotently, on every deploy/upgrade; sync mints
   its `instance_epoch` on first migrate.
6. Wait for `auth` / `sync` / `proxy` `/readyz` green.
7. **Bootstrap the first admin.** `docker compose exec auth bun run --cwd
   apps/auth-service bootstrap-admin` — the CLI is **not interactive** (takes no
   username): it mints the first `primary_admin` **invitation** (code +
   `qr_url = API_BASE_URL/join#<code>`), writes it to a `0600` file inside the
   container, and prints the path. `install.sh` cats that file back out so the
   operator sees the code/URL, then **redeems it in the user-client** to register
   the first admin (the username is chosen at registration). The CLI refuses
   (exit 1, "refusing to run") once a `primary_admin`/`auth_methods` row exists —
   which is how a re-run of `install.sh` stays idempotent here.
8. Final summary: the four public URLs, the config endpoint
   (`https://auth.<base>/api/v1/config`), and the operator's next actions.

Re-running `install.sh` after a config change is safe: filled secrets are kept,
services are recreated, no destructive step runs.

---

## 6. Documentation congruence

`obsidian/DEPLOYMENT.md` chapters 4–6 are rewritten to describe the **generator
flow** (clone → `generate.sh` → scp → `install.sh`) instead of the hand-copy
`compose.prod.yml.example` flow. Chapter 4's variable tables stay the source of
truth and gain the derived-hostname / `TRAEFIK_NETWORK` variables. `deploy/README.md`
is the quickstart; it points at DEPLOYMENT.md for depth. The proxy `PORT`
discrepancy (`.env.example` says `8080`, DEPLOYMENT §4.3 says `3300`) is
reconciled here — pick `.env.example` as truth and correct the doc.

---

## 7. Security posture (Larissa gate before squash)

This kit generates crypto-critical material and defines network exposure, so
Larissa audits before the squash of **Unit 2** (Unit 1 is image/CI — her call):

- **Secret entropy & encoding** — 32-byte keys, base64url without padding where
  the services expect it, htpasswd apr1 acceptable.
- **No secret in git or in the compose in clear** — secrets live only in
  `deployment.env` (git-ignored in the generated `out/`); the committed
  `deployment.env.template` holds placeholders only.
- **MinIO** — scoped key never root; versioning/ILM off; console/API unpublished.
- **Network exposure** — only Traefik binds 80/443; Postgres/Redis/MinIO have no
  `ports:`; OPS ports (`/metrics`, `/healthz`, `/readyz`) are never Traefik-routed.
- **OPAQUE idempotency** — `install.sh` must never regenerate a filled
  `OPAQUE_SERVER_SETUP` (a re-run bricking accounts is a critical failure mode).
- **`deployment.env` file mode** — `install.sh` chmods it `600`.

---

## 8. Testing

Deployment tooling is shell + compose, validated by exercise, not unit tests
(CLAUDE.md §10 — tests where clearly appropriate). The verification bar:

- `docker compose -f out/docker-compose.yml config` parses for both
  monitoring-on and monitoring-off renders.
- The backend image builds locally and each service boots (`/readyz` green)
  against a throwaway Postgres/Redis/MinIO.
- The frontend image serves `/admin/` (SPA fallback + isolation headers) — a
  `curl -I` check mirroring the existing frontend verification.
- A shellcheck pass on both scripts.

No provider keys, no live secrets in CI.

---

## 9. Build sequence (two squash units)

- **Unit 1 — Backend image + admin-in-frontend + CI.** `apps/backend/Dockerfile`,
  frontend Dockerfile + nginx `/admin/`, `docker.yml` `build-backend` job. Gate:
  both images build; services boot; `/admin/` served. (Larissa optional.)
- **Unit 2 — Deploy kit + doc congruence.** `deploy/*`, remove
  `infra/compose.prod.yml.example`, rewrite DEPLOYMENT.md 4–6. Gate: compose
  renders/parses both ways, shellcheck clean, **Larissa clear**.

---

## 10. Manual verification (Chris, on the VPS)

The device/VPS steps Chris runs himself:

1. `generate.sh` locally → inspect `out/deployment.env` (secrets present, OPAQUE
   empty) and `out/docker-compose.yml` (monitoring toggled correctly).
2. `scp -r out/ …` to a **staging** directory on the VPS (not the live one), point
   `BASE_DOMAIN` at test subdomains.
3. `install.sh` → watch: infra healthy → MinIO bucket+scoped key created → OPAQUE
   filled once → app services `/readyz` green → `bootstrap-admin` mints + surfaces
   the first `primary_admin` invitation (code + `/join#<code>` URL; no prompt).
   Redeem that invitation in the user-client to register the first admin.
4. Browser: `https://app.<test-base>` loads; `https://app.<test-base>/admin/`
   loads and sees the account; `https://auth.<test-base>/api/v1/config` returns
   `proxyUrl` / `syncUrl` / `features` incl. `blobs`.
5. Register → login → send a message routed through the new `proxy` → confirm sync
   pushes and a blob (image) round-trips via MinIO.
6. Re-run `install.sh` → confirm OPAQUE and the scoped key are **not** regenerated.
7. Cut-over: retire the throwaway `cors-proxy.tidesson.net`, fold the live
   `app.chatsundere.me` frontend into the unified stack.

---

## 11. Open questions

- **MinIO `mc` scoped-key mechanics** — the exact `mc` incantation and where the
  scoped key lands (§5.1 open point; resolved to the `install.sh`-driven approach,
  confirmed in the plan against a real `mc`).
- **Proxy port** — reconcile `8080` vs `3300` (§6) before the compose hard-codes a
  Traefik target port.
- **Frontend cut-over timing** — whether Chris migrates the live frontend into the
  unified stack in the same session as the first backend go-live or immediately
  after (operational, not a design blocker).
