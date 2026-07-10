# Deploying Chatsundere — operator reference

Audience: **Chris and third-party operators alike.** Chatsundere is AGPLv3;
self-hosting the backend is a first-class path, not an afterthought. This
document describes *the system* — a durable reference for anyone standing up
their own instance. It is written against the services as built, so every env
var name, default, and behaviour below is what the code actually does.

British English throughout. Every chapter ends with a constructive next step,
never a gate — if something here reads as a wall, that is a documentation bug.

> **Scope note.** The blob transport (MinIO/S3) documented here landed with
> Block 6C. The full stack — `auth-service`, `sync-service`, `proxy-service`,
> the frontend, and the supporting data services — is now defined once in
> `deploy/compose.template.yml` and rendered per-deployment by
> `deploy/generate.sh` (chapters 5–6); the hand-copied prod-compose example it
> superseded is retired.

---

## 1. Architecture overview

Chatsundere's backend is a small set of cooperating services behind one reverse
proxy. The reference front is **Traefik**, but any reverse proxy that terminates
TLS and routes by host works.

```
                         ┌──────────── Traefik (:80/:443, TLS) ────────────┐
   browser / PWA ──HTTPS─┤  auth.<domain>   → auth-service  (:3100)         │
                         │  sync.<domain>   → sync-service  (:3200)         │
                         │  proxy.<domain>  → proxy-service (:8080)         │
                         └──────────────────────────────────────────────────┘
                                    │ internal `chatsundere` network
        ┌───────────────┬───────────┼───────────────┬───────────────┐
     Postgres         Redis        MinIO        auth-service      sync-service …
    (:5432, int.)   (:6379, int.) (:9000, int.)
```

- **auth-service** — OPAQUE + passkey/PRF auth, JWT issuance (EdDSA), the
  invitation/pairing surface, and the public `GET /api/v1/config` self-description.
- **sync-service** — the zero-knowledge record store *and* the blob transport
  (`/api/v1/sync/blobs/*`), which streams sealed blobs to MinIO over the internal
  network.
- **proxy-service** — the authenticated CORS/egress proxy for LLM and MCP traffic.
- **Postgres** — one server; the auth and sync databases live here.
- **Redis** — rate limits, the JWT revocation deny-list (shared by auth + sync +
  proxy), the doorbell pub/sub, and doorbell tickets.
- **MinIO** — the S3-compatible object store holding sealed blob ciphertext.

**Public vs ops ports.** Each service exposes a **public** port (Traefik-routed)
and, separately, an **ops** port carrying `/healthz`, `/readyz`, `/metrics`. The
ops port is **never** Traefik-routed — Prometheus scrapes it over the internal
network only. **One public origin per service; MinIO is strictly internal** — no
Traefik host, no published port (neither the S3 API `:9000` nor the console
`:9001`).

*Next step:* skim chapter 2 to understand what you, the operator, can and cannot
see — it shapes every decision that follows.

---

## 2. The zero-knowledge posture — what you can and cannot see

This is the identity chapter, and it protects **you** as much as your users:
**you cannot leak what you cannot read.**

**What the server stores:** ciphertext only. Records are sealed client-side
(AES-256-GCM under a master-key-derived DEK) before a byte leaves the device;
their keys are HMAC-blinded so the server cannot even tell which logical row a
ciphertext is. Blobs (images, avatars, attachments) are likewise sealed
client-side; MinIO holds opaque byte strings under opaque keys
(`<account_id>/<blob_id>`). The server never holds a passphrase, a master key, a
plaintext, a MIME type, or an image dimension.

**What the server necessarily learns** (owned honestly, not hidden): per account,
the number of records and blobs, each blob's exact ciphertext size, and
upload/fetch/delete timing. **Traffic-shape correlation is real:** an artefact
creation is two back-to-back blob PUTs (thumbnail + original) followed by a record
push whose `collection` tag is cleartext, so the server *can* probabilistically
classify blobs and link one to the blind record that references it. Content, ids,
and the object graph stay sealed; this classification residue is the accepted,
stated cost of not padding multi-MiB images.

**What a malicious or compromised server can do:** withhold, roll back, or destroy
data; serve a blob under the wrong id (the client's GCM/AAD check rejects it) or
serve garbage (rejected likewise). It cannot read, forge, or swap content.
Integrity-of-history defences against a *malicious* server are consciously
post-beta — said plainly here so you can reason about your own threat model.

*Next step:* with that clear, chapter 3 sizes the box you will run this on.

---

## 3. Prerequisites

- **A VPS** with Docker Engine + the Compose plugin. A single modest instance is
  the v1 target (see chapter 8 on scaling honesty). Guidance: 2 vCPU / 4 GB RAM
  handles the current alpha cohort comfortably; the blob path is bandwidth-bound,
  so size disk and network to your expected image volume (the default account
  quota is 2 GiB shared records+blobs — see chapter 4).
- **A domain** with DNS pointing at the VPS, and sub-domains for each public
  service (`auth.`, `sync.`, `proxy.`) plus your ops hosts.
- **TLS.** Traefik with a Let's Encrypt cert resolver is the reference; any
  reverse proxy that terminates TLS works.
- **Disk** for four named volumes: `postgres_data`, `redis_data`, `minio_data`,
  and the Prometheus/Grafana volumes.

**Image provenance.** Application images are published to GHCR under the project
namespace, tagged `sha-<commit>` on every master build and `:latest` only on a
`v*.*.*` release tag (so a merge never moves `:latest`). MinIO, Postgres, Redis,
Prometheus and Grafana are pinned upstream images. Supported architecture is
`linux/amd64`. **Building from source** is fully supported and, for an AGPLv3
project, encouraged: each app has a `Dockerfile`; build with the repo root as the
build context (the images are monorepo-aware). The published images are a
convenience, not a requirement.

*Next step:* chapter 4 is the single source of truth for configuration — read it
alongside each service's `.env.example`.

---

## 4. Configuration reference

Every variable below is drawn from the services' `.env.example` files; keeping
this chapter congruent with them is part of the definition of done. A quick
self-check: `grep -E '^[A-Z_]+=' apps/<service>/.env.example` should list exactly
the variables documented here.

### 4.1 auth-service

| Var | Format | Secret | Notes |
|---|---|---|---|
| `NODE_ENV` | `production` | no | |
| `PORT` | int (`3100`) | no | public API port |
| `LOG_LEVEL` | `info`… | no | |
| `API_BASE_URL` | https URL | no | this service's public base |
| `DATABASE_URL` | `postgres://…/auth_db` | **yes** | |
| `REDIS_URL` | `redis://…` | maybe | MUST be the SAME Redis as sync/proxy (deny-list) |
| `AUTH_JWT_PRIVATE_KEY` | base64url, ≥40 chars | **yes** | EdDSA signing key |
| `OPAQUE_SERVER_SETUP` | opaque string, ≥40 | **yes** | long-term OPAQUE key material — generate ONCE (`bun run generate-opaque-setup`), back it up, never rotate: losing it permanently bricks every account's passphrase auth |
| `INVITATION_HMAC_KEY` | base64url, ≥40 | **yes** | |
| `REFRESH_TOKEN_HMAC_KEY` | base64url, ≥40 | **yes** | |
| `HMAC_KEY_PENDING_CODES` | base64url, ≥40 | **yes** | leak-domain-isolated |
| `DECOY_WRAP_KEY` | base64url, ≥40 | **yes** | leak-domain-isolated; derives decoy OPAQUE wraps for unknown/suspended `login/start` calls (Finding #10a) |
| `CORS_ALLOWED_ORIGINS` | comma list | no | exact origins |
| `TRUST_PROXY_HOPS` | int (`1`) | no | trusted front-proxy hops for the per-IP rate-limit client IP; **set `0` if auth is exposed without a fronting proxy** |
| `PROXY_PUBLIC_URL` | https URL | no | surfaced by `/api/v1/config`; omit to hide the proxy feature |
| `SYNC_PUBLIC_URL` | https URL | no | surfaced as `syncUrl` + the `sync` feature |
| `SYNC_BLOBS_ENABLED` | `true`/`false` | no | **congruence checkpoint** — see below |

### 4.2 sync-service

| Var | Format / default | Secret | Notes |
|---|---|---|---|
| `NODE_ENV` | `production` | no | |
| `PORT` | `3200` | no | public sync API |
| `OPS_PORT` | `9091` | no | health + metrics; **never** Traefik-routed |
| `LOG_LEVEL` | `info` | no | |
| `DATABASE_URL` | `postgres://…/sync_db` | **yes** | |
| `REDIS_URL` | `redis://…` | maybe | same instance as auth (deny-list, spec §9) |
| `JWT_ISSUER` | `chatsundere-auth-v1` | no | MUST match auth-service exactly |
| `JWT_AUDIENCE` | `chatsundere-services` | no | declared, ignored |
| `AUTH_JWKS_URL` | URL | no | auth-service JWKS endpoint |
| `CORS_ALLOWED_ORIGINS` | comma list | no | |
| `TRUST_PROXY_HOPS` | `1` | no | trusted front-proxy hops for client-IP |
| `RATE_LIMIT_USER_PER_MIN` | `120` | no | |
| `RATE_LIMIT_IP_PER_MIN` | `600` | no | |
| `RATE_LIMIT_DELETE_PER_MIN` | `60` | no | shared by record tombstones **and** blob deletes |
| `MAX_RECORD_BYTES` | `2097152` | no | 2 MiB per record |
| `ACCOUNT_QUOTA_BYTES` | `2147483648` | no | **2 GiB, SHARED by records + blobs** |
| `MAX_PUSH_RECORDS` | `100` | no | |
| `MAX_BODY_BYTES` | `25165824` | no | 24 MiB JSON push body; **blob PUTs are exempt** |
| `MAX_BLOB_BYTES` | `33554432` | no | 32 MiB ciphertext body per blob |
| `BLOB_QUOTA_FLOOR_BYTES` | `65536` | no | 64 KiB accounting floor per blob |
| `BLOB_UPLOAD_IDLE_TIMEOUT_S` | `30` | no | aborts a stalled PUT |
| `PULL_LIMIT_DEFAULT` / `PULL_LIMIT_MAX` | `200` / `500` | no | |
| `PULL_BYTE_BUDGET` | `8388608` | no | 8 MiB per pull page |
| `DOORBELL_TICKET_TTL_S` | `30` | no | |
| `WS_PING_INTERVAL_S` | `30` | no | doorbell liveness ping |
| `WS_IDLE_TIMEOUT_S` | `255` | no | Bun caps this at 255; ping carries liveness |
| `MAX_SOCKETS_PER_ACCOUNT` | `8` | no | |
| `S3_ENDPOINT` | e.g. `http://minio:9000` | no | **unset ⇒ blobs disabled** |
| `S3_REGION` | `us-east-1` | no | MinIO ignores; AWS needs it |
| `S3_BUCKET` | `chatsundere-blobs` | no | created at boot if absent |
| `S3_ACCESS_KEY_ID` | scoped key | **yes** | pino-redacted; NOT the MinIO root user |
| `S3_SECRET_ACCESS_KEY` | scoped secret | **yes** | pino-redacted |

Setting `S3_ENDPOINT` **requires** both `S3_ACCESS_KEY_ID` and
`S3_SECRET_ACCESS_KEY` — the service refuses to boot otherwise, by design.

The S3 client uses **path-style addressing only** (`<endpoint>/<bucket>/<key>`)
— MinIO, Garage, and Hetzner Object Storage all speak it. Endpoints that
require virtual-host-style addressing are not supported; there is no
configuration knob pretending otherwise.

### 4.3 proxy-service

`NODE_ENV`, `PORT` (`8080`), `OPS_PORT` (`9090`), `LOG_LEVEL`, `REDIS_URL`, `JWT_ISSUER`,
`JWT_AUDIENCE`, `AUTH_JWKS_URL`, `CORS_ALLOWED_ORIGINS`, `TRUST_PROXY_HOPS`,
`RATE_LIMIT_USER_PER_MIN`, `RATE_LIMIT_IP_PER_MIN`, `MAX_BODY_BYTES`,
`MAX_CONCURRENT_PER_USER`, `PROXY_IDLE_TIMEOUT_S`.

### 4.4 The blobs congruence checkpoint

The `"blobs"` feature in `GET /api/v1/config` is a **manual pairing** across two
services:

- **auth-service `SYNC_BLOBS_ENABLED=true`** advertises the feature to clients.
- **sync-service `S3_ENDPOINT` set** makes the blob endpoints actually work.

Keep them in step. If the flag is on but `S3_ENDPOINT` is unset, clients meet
`501 blobs_disabled` and fall back to placeholder mode (no retry loop). If the
flag is off but S3 is configured, the capability sits unused — harmless, wasteful.
Either drift is safe but pointless; set both, or neither.

Generate secrets with e.g. `openssl rand -base64 32 | tr '+/' '-_' | tr -d '='`
(base64url) for the HMAC keys, and a real EdDSA key for `AUTH_JWT_PRIVATE_KEY`.

### 4.5 Template-level variables (`deploy/deployment.env.template`)

These sit above the four service tables — they drive Traefik routing and
hostnames rather than any one service's `.env`, and `deploy/generate.sh`
prompts for them interactively rather than expecting you to hand-edit them:

| Var | Format | Secret | Notes |
|---|---|---|---|
| `INSTANCE_NAME` | lowercase alphanumeric + hyphen (`chatsundere`) | no | namespaces the compose project, Traefik router/service/middleware names, the internal network, and the Watchtower scope — set a different value per stack when running multiple Chatsundere instances behind one Traefik (see the note at the end of §5) |
| `BASE_DOMAIN` | e.g. `chatsundere.me` | no | the domain every `HOST_*` is derived from |
| `HOST_APP` | `app.<domain>` | no | frontend + admin-client (`/admin/`) |
| `HOST_AUTH` | `auth.<domain>` | no | |
| `HOST_SYNC` | `sync.<domain>` | no | |
| `HOST_PROXY` | `proxy.<domain>` | no | |
| `HOST_PROMETHEUS` | `prometheus.<domain>` | no | only used when monitoring is rendered in |
| `HOST_GRAFANA` | `grafana.<domain>` | no | only used when monitoring is rendered in |
| `TRAEFIK_NETWORK` | docker network name (`traefik`) | no | your **existing** Traefik's external network |
| `TRAEFIK_CERTRESOLVER` | Traefik cert resolver name (`letsencrypt`) | no | as configured in your own Traefik |

`generate.sh` derives `API_BASE_URL`, `PROXY_PUBLIC_URL`, `SYNC_PUBLIC_URL`,
`ADMIN_PUBLIC_URL`, and `CORS_ALLOWED_ORIGINS` from the `HOST_*` values, so they
do not need separate prompts — they still appear as ordinary vars in the
rendered `deployment.env` and are covered by the §4.1/4.2 tables above.

*Next step:* chapter 5 walks the generator that turns this reference into a
running deployment.

---

## 5. Generate (local)

The deploy kit is a **two-phase, secret-generating installer**: `deploy/generate.sh`
runs on your laptop and produces a self-contained `out/` directory; `deploy/install.sh`
(chapter 6) runs on the VPS and brings the stack up. Quickstart in
`deploy/README.md`; this chapter is the operator-level detail behind it.

`generate.sh` depends on nothing but `bash` ≥ 4, `openssl`, and `awk` —
deliberately dependency-light for the local phase, and openssl-only for secret
generation (no GNU coreutils, no `basenc`). Stock macOS `/bin/bash` is 3.2 (the
script uses bash-4 associative arrays); macOS operators need Homebrew bash. The
built-in LibreSSL `openssl` on macOS is sufficient — no other install needed.

```bash
cd deploy
./generate.sh
```

It prompts for `BASE_DOMAIN`, `INSTANCE_NAME` (default `chatsundere`),
`TRAEFIK_NETWORK` (default `traefik`), `TRAEFIK_CERTRESOLVER` (default
`letsencrypt`), whether to include Prometheus + Grafana, whether to include a
scoped Watchtower, and — optionally — per-host overrides for
`HOST_APP`/`HOST_AUTH`/`HOST_SYNC`/`HOST_PROXY` if you don't want the
`app./auth./sync./proxy.<domain>` convention (§4.5).

What it renders into `out/`:

- **`deployment.env`** — every var from §4 filled with a random secret
  (`POSTGRES_PASSWORD`, `MINIO_ROOT_USER`/`PASSWORD`, `GRAFANA_ADMIN_PASSWORD`,
  `TRAEFIK_AUTH_USERS` (an `apr1` hash for the monitoring basic-auth
  middleware), `AUTH_JWT_PRIVATE_KEY`, `INVITATION_HMAC_KEY`,
  `REFRESH_TOKEN_HMAC_KEY`, `HMAC_KEY_PENDING_CODES`, `DECOY_WRAP_KEY`) — **except**
  `OPAQUE_SERVER_SETUP` and the MinIO scoped `S3_ACCESS_KEY_ID`/
  `S3_SECRET_ACCESS_KEY`, which stay `CHANGE-ME-ON-SERVER`: those are minted
  once, on the server, by `install.sh`, so they never sit on a laptop or
  transit over `scp` unnecessarily. Written `chmod 600`.
- **`docker-compose.yml`** — rendered from `deploy/compose.template.yml` with
  the monitoring/Watchtower blocks trimmed per your y/N answers. It pins
  `name: ${INSTANCE_NAME}` at the top level, which fixes the Compose project
  name (and therefore the internal network's real name,
  `<INSTANCE_NAME>_chatsundere`) regardless of the directory `install.sh` runs
  from on the server.
- **`postgres-init/`** — the multi-database bootstrap script, copied in
  verbatim.
- **`install.sh`** — copied alongside so `out/` is fully self-contained; it
  reads back `deployment.env` for everything it needs.

Validate before shipping: `docker compose -f out/docker-compose.yml --env-file
out/deployment.env config` must parse.

Ship it:

```bash
scp -r out/ user@your-vps:/opt/chatsundere
```

**Running multiple instances on one host.** Give each Chatsundere stack
sharing a host/Traefik a distinct `INSTANCE_NAME` (and distinct hostnames).
Everything else — the compose project, the Traefik router/service/middleware
names, the internal docker network, and the Watchtower scope — namespaces off
that value automatically, so the stacks never collide.

*Next step:* chapter 6 installs and bootstraps the stack on the server.

---

## 6. Install & bootstrap (server)

```bash
ssh user@your-vps 'cd /opt/chatsundere && ./install.sh'
```

`install.sh` is **idempotent** — safe to re-run; it fills each generate-once
secret only while it is still `CHANGE-ME-ON-SERVER`, and every other step
either no-ops or converges on a re-run. What it does, in order:

1. **Preflight.** `docker compose config` must parse, and the Traefik external
   network named by `TRAEFIK_NETWORK` must already exist — it refuses to start
   with a clear message (create it with `docker network create <name>`, or
   point `TRAEFIK_NETWORK` at the network your existing Traefik already uses)
   rather than silently standing up an orphaned network.
2. **Data services.** Brings up `postgres`, `redis`, `minio` and waits for all
   three healthchecks.
3. **MinIO bucket + scoped key — now automated.** Creates the `chatsundere-blobs`
   bucket (`mc mb --ignore-existing`), suspends object versioning as a
   belt-and-braces measure (new buckets are unversioned by default; versioning
   would break the deletion promise — chapter 9/10), and mints a
   bucket-scoped access key (`mc admin user svcacct add`, policy limited to
   that one bucket's CRUD) written into `S3_ACCESS_KEY_ID`/
   `S3_SECRET_ACCESS_KEY` in `deployment.env` — **never** the MinIO root
   credential. Skipped on re-run once a real key is present.
4. **OPAQUE server setup — generated once.** Runs `bun run generate-opaque-setup`
   once, inside the backend image, and writes the result into
   `OPAQUE_SERVER_SETUP` in `deployment.env`. **Never rotate this value** —
   every registration record is bound to it; losing or regenerating it
   permanently bricks every account's passphrase authentication (passkey
   unlock is unaffected). **Back up `deployment.env` immediately after this
   step succeeds.** Skipped on re-run once a real value is present.
5. **Application services.** A single `docker compose up -d` brings up every
   service the rendered compose file defines — `auth`, `sync`, `proxy`,
   `frontend`, and monitoring/Watchtower if you opted in. **auth and sync
   migrate-then-serve in their own compose command**
   (`cd apps/<svc>-service && bun run db:migrate && exec bun src/index.ts`) —
   `index.ts` itself runs no migrator. So every deploy, and every Watchtower
   image pull, self-migrates idempotently; there is **no separate manual
   migration step on upgrade**. The sync-service also mints its
   `instance_epoch` on its first-ever migrate.
6. **Wait for `/readyz`** on `auth`, `sync`, and `proxy`.
7. **Bootstrap the first admin.** `bootstrap-admin`
   (`apps/auth-service/src/cli/bootstrap.ts`) is **not interactive** — it takes
   no username, no stdin at all. It mints the first `primary_admin`
   **invitation** (a code plus `qr_url = API_BASE_URL/join#<code>`), writes it
   to a `0600` file inside the container, and prints the path; `install.sh`
   cats that file back out to your terminal. **Redeem that invitation in the
   user-client** (`https://<HOST_APP>/join`) to register the actual first
   admin account — you choose the username at registration, not on the
   server. It refuses (exit 1, "refusing to run") once a `primary_admin`
   already exists, which `install.sh` treats as success rather than failure —
   the mechanism that makes re-running the script safe.

Point a client at your instance once it's up — it discovers topology from
`GET https://<HOST_AUTH>/api/v1/config`, which returns `proxyUrl`, `syncUrl`,
and the `features` array (`proxy`, `sync`, and `blobs` when the checkpoint in
§4.4 is satisfied).

*Next step:* chapter 7 is the part you will actually revisit — running it day to
day, and getting your data back when something breaks.

---

## 7. Operations

**Metrics.** Each service's ops port serves Prometheus metrics; scrape targets are
the internal `<service>:<OPS_PORT>` addresses. Blob-specific series (all
ciphertext-blind, no account/blob labels): `sync_blob_uploads_total{outcome}`,
`sync_blob_downloads_total{outcome}`, `sync_blob_deletes_total`, `sync_blob_bytes`,
`sync_blob_backend_errors_total`, `sync_blob_backend_up`, and
`sync_blob_inconsistency_total`. Watch `sync_blob_backend_up` for object-store
health and `sync_blob_inconsistency_total` for DB/S3 skew.

**Logs.** Structured JSON (pino), ciphertext-blind, with no account/blob
identifiers. S3 credentials are redacted at the logger even if an env-shaped
object is ever logged.

**Upgrades.** Pull the new tag-gated image and recreate; `:latest` only moves on a
`v*.*.*` release tag, so scope any Watchtower to conscious releases.

**Keep MinIO current — a conscious duty, not a Watchtower job.** MinIO stopped
publishing community container images in October 2025; `deploy/compose.template.yml`
pins the newest published image (`RELEASE.2025-09-07T16-13-09Z`), and later security
fixes — including the CVE-2025-62506 session-policy fix in
`RELEASE.2025-10-15T17-29-55Z` — exist **only as source releases**. The exposure
is bounded here (exploiting it needs valid S3 credentials; the store is
internal-network-only with a single scoped-key client), but review the pin at
every release cut: build MinIO from source, use a maintained third-party build
you trust, or move to a maintained S3-compatible store (e.g. Garage) — a
deliberate decision, never drift.

**Backups & restore.** Postgres **and** the MinIO bucket are the backup pair —
take them close together. Skew self-heals (a client re-uploads a blob the server
lost, idempotently, under deterministic sealing), but avoid it where you can.
Redis is safe to lose (rate-limit counters and the deny-list rebuild).

> **Restore runbook — flip the epoch.** The sync `instance_epoch` lives *inside*
> the Postgres backup (`sync_meta`), so a plain `pg_restore` reinstates the **old**
> epoch and **no client recovery fires** — exactly the silent divergence the epoch
> exists to prevent. After restoring:
>
> 1. Restore the Postgres backup (and the MinIO bucket, taken close to it).
> 2. Run `DATABASE_URL=… bun tools/re-epoch.ts --yes` in the sync-service — mints
>    a fresh epoch, invalidating every client watermark → clean re-sync.
> 3. **Restart the sync-service — mandatory.** The service reads `instance_epoch`
>    **once at boot** and serves that cached value; skip the restart and the
>    database holds the new epoch while the service keeps echoing the old one —
>    the silent divergence persists indefinitely. (The tool prints this reminder
>    on success.)
>
> The alternative — excluding `sync_meta` data from the dump — does **not** mint
> a fresh epoch by itself: the Drizzle migration journal is inside the backup
> too, so the epoch-seeding migration does not re-run, and the sync-service
> **refuses to boot** on an empty `sync_meta` (a loud, constructive failure, not
> a bug). Run `re-epoch` (it handles the empty table) and start the service —
> the boot itself then reads the fresh epoch, so no separate restart is needed
> in that path.

Honest caveats: backup **retention is deletion latency** — a blob you deleted
persists in bucket backups until they rotate. And a restore can **resurrect blobs
whose referencing records are tombstoned** (quota-charged orphans) until the
client-side/reconcile sweep ships (a named post-beta deferral).

*Next step:* chapter 8 tells you honestly how far one box goes.

---

## 8. Scaling honesty

v1 is **single-replica** by design. The doorbell (the WebSocket that pokes clients
to pull) keeps its socket registry **in-process**, so running two sync-service
replicas would mean a poke reaches only the clients on that replica. The blob path
itself is stateless per request and would scale before the doorbell does — but
until the doorbell is externalised, run one sync-service replica. This is stated
plainly rather than promised away: for the current cohort, one adequately-sized box
is the right answer, not a limitation you will hit by surprise.

*Next step:* chapter 9 collects the failure shapes you are most likely to meet.

---

## 9. Troubleshooting

- **Clients show image placeholders / `501 blobs_disabled`.** The `"blobs"`
  checkpoint (§4.4) is half-set: either the sync-service has no `S3_ENDPOINT`, or
  auth-service `SYNC_BLOBS_ENABLED` is off. Set both. → Next: re-check
  `GET /api/v1/config` shows `blobs` in `features`.
- **Blob GET/PUT returns `503 blob_backend_unavailable`.** MinIO is unreachable
  from the sync-service. Record sync is unaffected (`readyz` stays green by design).
  → Next: `docker compose ps minio`; the service retries the bucket bootstrap every
  30 s and recovers without a restart.
- **`507 quota_exceeded` sooner than expected.** The quota is **shared** by records
  and blobs, and each blob charges at least the 64 KiB floor. → Next: `GET
  /api/v1/sync/blobs` shows the account's blob total; raise `ACCOUNT_QUOTA_BYTES` if
  appropriate.
- **A loud "versioning enabled" warning at boot.** Object versioning on the blob
  bucket would keep deleted ciphertext retrievable, breaking the deletion promise.
  → Next: disable versioning on the bucket (chapter 10).
- **Clients re-sync everything after a restore.** Expected if you ran `re-epoch`
  (chapter 7) — that is the epoch doing its job. → Next: nothing; it settles.

*Next step:* chapter 10 is the security checklist to run before you go live.

---

## 10. Operator security checklist

- **Ops ports never public.** `/metrics`, `/healthz`, `/readyz` live on each
  service's ops port and are scraped over the internal network only — never
  Traefik-routed.
- **Secrets hygiene.** All HMAC keys and the EdDSA private key are strong,
  unique, and out of version control (`deploy/out/` — where `generate.sh`
  writes `deployment.env` — is git-ignored).
- **TLS everywhere public.** Traefik terminates TLS; no plaintext public ingress.
- **Shared Redis for the deny-list.** auth, sync, and proxy MUST share one Redis
  instance/db so a revoked session dies everywhere within the second. Losing Redis
  is safe for data but drops the deny-list until it rebuilds — protect it.
- **MinIO specifics:**
  - Neither the S3 API port (`:9000`) nor the **web console** (`:9001`) is
    published — internal network only.
  - **No default root credentials.** `minioadmin`/`minioadmin` must never survive;
    `deploy/compose.template.yml`'s `:?` guards enforce a conscious value, and
    `generate.sh` fills it with a random one before you ever see the file.
  - The sync-service runs on a **scoped access key** limited to one bucket's CRUD,
    **not** the root credential.
  - **Versioning and ILM off** (or documented as breaking the deletion promise —
    the bootstrap warns loudly if versioning is on).
  - **Audit/access logging implications:** MinIO access logs record object keys +
    request timing — exactly the access-pattern residue chapter 2 owns. Enabling
    them materialises that residue at rest; decide deliberately, and protect the
    logs as you would the DB.

*Next step:* you are ready. Bring the stack up (chapter 6), run
`GET /api/v1/config` to confirm the topology your clients will see, and mint your
first invitation.
