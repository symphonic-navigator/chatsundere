# Blob Transport (S3/MinIO) + Deployment Docs — Implementation Plan (Block 6C)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

## Operating rules for the overnight worker (READ FIRST)

These rules are binding and override your defaults. They encode repo
conventions you cannot otherwise see.

1. **Language.** Every artefact you produce — code, comments, tests, commit
   messages, log strings, docs — is **British English** (`colour`,
   `initialise`, `behaviour`). No German anywhere in the repo. No emojis in
   code or commits.
2. **Branch discipline.** Work happens on **`feat/backend-03-blobs`**, forked
   from the current `master`. **STOP-guard before anything else:**
   `apps/sync-service/src/routes/changes.ts` must exist and
   `apps/sync-service/src/routes/blobs.ts` must NOT — if either check fails,
   the base is wrong; stop and report instead of improvising. **Never merge to
   `master`, never push, never switch the branch mid-run.** Subagents never
   merge, push, or switch branches either — put that sentence in every
   subagent prompt.
3. **Baseline capture, before the first task.** On `master`, with the dev
   services up, run and RECORD (counts + any failure names):
   - `docker compose -f infra/compose.dev.yml up -d postgres redis`
   - `cd apps/sync-service && TEST_DATABASE_URL=<the test-db URL per
     .env.example / tests/helpers/test-db.ts> bun test`
   - `cd apps/auth-service && bun test` (it has its own `TEST_DATABASE_URL`
     isolation — read its `.env.example`)
   - the `packages/crypto` test suite (see its `package.json` scripts)
   - `pnpm typecheck --force` (expect 14/14)
   Anything failing here is the **known baseline** — re-confirm on `master`
   before blaming or "fixing" it on your branch; never paper over a NEW
   failure as pre-existing.
4. **TDD per task, literally.** Failing test → run to confirm FAIL → minimal
   implementation → run to confirm PASS → commit. No implementation-first, no
   tests-after.
5. **Execution discipline.** One fresh subagent per task
   (superpowers:subagent-driven-development), two-stage review per task
   (spec-compliance review, then code-quality review) before its commit is
   accepted. Tasks in order; Task 0's probe decisions gate Tasks 5–7.
6. **Verification is FULL-suite.** At the end (Task 16) run every suite named
   in rule 3 plus Biome on changed files — not just the directories you
   touched. `pnpm typecheck --force` is the CI gate (Turbo caches: without
   `--force` a cached pass lies to you).
7. **Commits.** One squashable commit per task, imperative subject, prefixed
   `03: ` (e.g. `03: Add the blob transport routes`). Doc-only commits append
   ` [skip ci]` (exactly that form, with the space). Every commit ends with
   the trailer, verbatim:
   `Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>`
8. **Security boundary.** This run touches `apps/sync-service`,
   `apps/auth-service`, and `packages/crypto` — all Larissa-audited paths.
   The audit happens **after** your run, at home, on the built diff, before
   any squash-to-master. You do not run it and you do not merge; your job
   ends at the hand-off report. Do not weaken any invariant the spec marks
   `[L]`/`[F]` — if a task seems to require it, STOP and flag it in the
   report instead.
9. **Environment for tests.** Integration tests need Postgres + Redis (and
   from Task 3 on, MinIO) from `infra/compose.dev.yml`, plus
   `TEST_DATABASE_URL` per the existing pattern in
   `apps/sync-service/tests/helpers/test-db.ts` (it refuses non-test URLs by
   design). S3-dependent tests follow the same discipline via
   `S3_TEST_ENDPOINT` (Task 5 defines it); when MinIO is unavailable they
   must skip loudly, never silently.
10. **Deviation rule.** If a probe result or implementation reality
    contradicts the spec
    (`superpowers/specs/2026-07-02-blob-transport-and-deployment-docs-design.md`),
    stop that task, record the contradiction (probe README or commit
    message), choose the smallest spec-consistent resolution, and flag it in
    the final report. Never silently diverge from the spec §7.1 pipeline
    order, the §7.5 status table, or the §5 crypto pins.
11. **End of run.** Final doc commit on the branch: update
    `obsidian/STATUS-BACKEND.md` — add a dated entry saying Block 6C blob
    transport is BUILT on `feat/backend-03-blobs`, awaiting Larissa audit +
    Chris device-verify + merge; do not restructure the rest of the file.
    Then report back: per-suite verification numbers (against the rule-3
    baseline), the probe decisions from Task 0, any deviation flags, and
    `git log --oneline master..HEAD`.

**Goal:** Bring `personaAvatars`, `artefacts`, and `attachments` into sync via an S3/MinIO blob transport proxied through `sync-service`, and write the operator-facing `obsidian/DEPLOYMENT.md`.

**Architecture:** Client-side sealed blobs (AES-256-GCM, MK-derived DEK, **deterministic SIV-style nonce**) stream through new `/api/v1/sync/blobs/*` routes on the existing `sync-service` into an internal S3-compatible store. Blobs are immutable, rev-less, doorbell-less; the referencing record rides the existing push/pull channel. One shared account quota, enforced **inside** the locked transaction. MinIO never leaves the compose network.

**Spec:** `superpowers/specs/2026-07-02-blob-transport-and-deployment-docs-design.md` (v2, dual-review folded — the section numbers below, "spec §N", refer to it). Read it in full before Task 0.

**Tech Stack:** Bun + Hono (sync-service), Drizzle + postgres-js, Valibot, prom-client, WebCrypto (packages/crypto), MinIO (dev/reference), Bun test runner (server), Vitest (packages/crypto).

**Branch:** `feat/backend-03-blobs`, forked from `master` **after** the 6A/6B merges (verify: `apps/sync-service/src/routes/changes.ts` exists and `cd apps/sync-service && bun test` is green before starting — STOP if not).

## Global Constraints

- Every artefact in British English (code, comments, tests, commit messages, docs). AGPL-3.0 SPDX header on every new `apps/*` file, LGPL-3.0 on `packages/crypto` files, MIT on `packages/shared-types` files (match each package's existing headers exactly).
- TypeScript strict; no `any` without an inline justification comment. Biome is the pre-commit gate; it bans `!` non-null assertions.
- Tests live under `tests/**` (sync-service) / alongside existing crypto test layout. Run the full affected suite per task, not just the new file.
- No log line or metric label may carry `account_id`/`sub`/`jti`/`blob_id` (spec §8; existing `anonymity.test.ts` discipline).
- Commit per task, imperative subject, prefix `03: ` (mirrors the 6B run's `02: ` prefix). Doc-only commits append ` [skip ci]`.
- Subagents never merge, push, or switch branches.
- Env var names, defaults, error codes, and HTTP statuses come from spec §7.5/§14 **verbatim** — do not improvise.
- The gate at the end of every task: `pnpm typecheck --force` green repo-wide, package tests green, Biome clean on changed files.

---

### Task 0: Probes (spec §21) — run BEFORE locking Tasks 5–7 details

**Files:**
- Create: `apps/sync-service/probes/s3-client.ts`
- Create: `apps/sync-service/probes/body-stream.ts`
- Create: `apps/sync-service/probes/README-blobs.md` (probe results, decision record)

The 6B run's `probes/` directory is the pattern (`bytea-lock.ts`, `ws-idle.ts`). MinIO must be running first — do the Task 3 compose step (MinIO service) before probing, or run a throwaway `docker run --rm -p 9000:9000 minio/minio server /data`.

- [ ] **Probe 1 — S3 client choice.** In `probes/s3-client.ts`, exercise **Bun's native S3 client** (`Bun.S3Client`) against local MinIO: streaming PUT with known `Content-Length` at 32 MiB (feed a `ReadableStream`, watch RSS), streaming GET, `forcePathStyle`, bucket create when absent + when present, error shape when the endpoint is a closed port, **and whether multipart upload is used at 32 MiB** (watch MinIO's request log: one `PUT` vs `CreateMultipartUpload`). Repeat the same matrix with `@aws-sdk/client-s3` only if the native client fails any leg.

  **Decision matrix:** native client passes all legs → use it (no new dependency). Native client buffers whole bodies or cannot stream GET → `@aws-sdk/client-s3` + `@aws-sdk/lib-storage`. Multipart in play → Task 5's bootstrap MUST set the `AbortIncompleteMultipartUpload` lifecycle rule (spec §8); single-shot → lifecycle rule omitted, note it in the probe README.
- [ ] **Probe 2 — request-body streaming.** In `probes/body-stream.ts`, a minimal `Bun.serve` + Hono route consuming `c.req.raw.body` as a `ReadableStream` at 32 MiB: confirm chunked consumption (RSS stays flat), incremental SHA-256 via `crypto.subtle.digest` on accumulated chunks is wrong — use a streaming hasher (`Bun.CryptoHasher('sha256')`), confirm abort on client disconnect mid-body is observable (stream error/close), confirm behaviour when the client sends **more** bytes than `Content-Length` and when it stalls (no bytes for >30 s).

  **Decision matrix:** `ReadableStream` works chunk-wise → pipeline as planned in Task 7. Bun buffers the body regardless → cap memory risk by rejecting bodies over `MAX_BLOB_BYTES` up front (already planned) and note the buffering honestly in the probe README + spec deviation note. Stall detection needs manual timers → implement the inactivity timeout with a watchdog reset per chunk.
- [ ] **Probe 3 — GET passthrough.** Extend `probes/s3-client.ts`: stream a 32 MiB object from MinIO through a Hono response (`c.body(stream)`), slow reader (throttle), watch RSS + backpressure; confirm `Content-Length` propagates.
- [ ] **Probe 4 — `Content-Length` surfacing.** Confirm `c.req.header('content-length')` is present pre-body for a normal PUT and that a chunked-encoding request (no `Content-Length`) is distinguishable (header absent) → reject `411`.
- [ ] **Probe 5 — MinIO bootstrap.** From Bun: bucket create idempotency, `GetBucketVersioning` on a fresh bucket (expect unset/off) and after `mc version enable` (expect `Enabled` — drives the §8 warning), healthcheck endpoint (`/minio/health/live`) for the compose healthcheck.
- [ ] **Probe 6 — WebCrypto 32 MiB single-shot GCM.** In `packages/crypto` (a scratch script is fine): `crypto.subtle.encrypt` AES-GCM on a 32 MiB `Uint8Array` under Bun — record time + peak memory. If it is pathological (>5 s or OOM-ish), the decision is to LOWER `MAX_BLOB_BYTES`' default, not to chunk — note for Chris. (Realistic payloads are single-digit MiB.)
- [ ] **Record all outcomes + decisions in `probes/README-blobs.md`, commit:** `03: Add blob-transport probes and decision record`

---

### Task 1: `packages/crypto` — the blob envelope (`sync-blob`)

**Files:**
- Create: `packages/crypto/src/sync-blob/index.ts`, `packages/crypto/src/sync-blob/seal.ts`
- Modify: `packages/crypto/src/index.ts` (re-export)
- Test: mirror the existing `sync-envelope` test location/pattern (find its `*.test.ts` and sit beside it)

**Interfaces (Produces):**
```ts
/** Mints a random 128-bit blob id, base64url (22 chars). */
export function mintBlobId(): string;
/** Deterministically seals blob bytes: body = nonce(12) || GCM ciphertext. */
export async function sealBlob(mk: MasterKey, blobId: string, bytes: Uint8Array):
  Promise<{ body: Uint8Array; hash: Uint8Array }>;   // hash = SHA-256(body)
export async function openBlob(mk: MasterKey, blobId: string, body: Uint8Array):
  Promise<Uint8Array>;
export const BLOB_AAD_PREFIX = 'chatsundere-blob-v1';
```

- [ ] **Step 1: failing tests.** Following the sync-envelope test style, cover (spec §18 "Envelope"): round-trip at 3 MiB of random bytes; **determinism** — two `sealBlob` calls with identical `(mk, blobId, bytes)` produce byte-identical `body` and `hash`; divergence — different `blobId` (same bytes), different bytes, different MK each produce different bodies; AAD tamper — `openBlob` with a foreign `blobId` rejects; a body whose version prefix is forged to `chatsundere-blob-v2` context rejects (construct by sealing with a hacked AAD via the internal seal function, or assert the AAD constant is baked in); truncated body (<28 bytes) rejects; `mintBlobId()` returns 22 base64url chars decoding to 16 bytes, unique across 1000 mints; **plaintext-hash-never-on-wire** — serialise `{blobId, body, hash}` as the full wire material and assert `SHA-256(bytes)` does not appear as a substring (the NSFW-scan discipline).
- [ ] **Step 2: run, verify FAIL** (module not found).
- [ ] **Step 3: implement.** Derivation per spec §5, using the existing `deriveDek(mk, context)` (`packages/crypto/src/dek.ts`):
```ts
// seal.ts (LGPL header; imports from ../dek.js, ../primitives as the envelope does)
const ENC_CONTEXT = 'sync/blobs-v1';
const NONCE_CONTEXT = 'sync/blobs-nonce-v1';

async function deriveNonce(mk: MasterKey, blobId: string, plainHash: Uint8Array): Promise<Uint8Array> {
  const nonceKey = await deriveDek(mk, NONCE_CONTEXT);
  const hmacKey = await crypto.subtle.importKey('raw', nonceKey.bytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const input = new Uint8Array([...new TextEncoder().encode(blobId), ...plainHash]);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', hmacKey, input));
  return mac.slice(0, 12); // 96-bit truncation of the OUTPUT (spec §5 pin)
}
```
  `sealBlob`: `plainHash = SHA-256(bytes)` (stays in-function — never returned, never exported); nonce as above; AAD = `utf8(BLOB_AAD_PREFIX) || utf8(blobId)`; encrypt with the `ENC_CONTEXT` DEK; `body = concat(nonce, ciphertext)`; `hash = SHA-256(body)`. `openBlob`: split nonce/ciphertext, decrypt with same AAD, reject cleanly on any failure (reuse the package's error types). Reuse the exact `deriveDek`/AES-GCM call shapes from `sync-envelope/seal.ts` — WebCrypto parity is inherited by construction.
- [ ] **Step 4: run tests → PASS.** Run the whole crypto package suite.
- [ ] **Step 5: Commit:** `03: Add deterministic blob envelope to packages/crypto`

---

### Task 2: `packages/shared-types` — BlobRef, wire types, allowlist

**Files:**
- Modify: `packages/shared-types/src/sync.ts`
- Test: extend the existing sync-service `apps/sync-service/tests/push.test.ts` allowlist case (Step 4)

**Interfaces (Produces):**
```ts
export interface BlobRef { blobId: string; bytes: number }
export type SyncBlobErrorCode =
  | 'blob_too_large' | 'quota_exceeded' | 'blob_exists' | 'hash_mismatch'
  | 'not_found' | 'delete_rate_limited' | 'blob_backend_unavailable' | 'blobs_disabled';
export interface BlobListEntry { blobId: string; bytes: number }
export interface BlobListResponse { blobs: BlobListEntry[]; totalBytes: number; quotaBytes: number }
export interface BlobErrorBody {
  error: { code: SyncBlobErrorCode; message: string;
    usedBytes?: number; quotaBytes?: number; maxBlobBytes?: number };
}
```

- [ ] **Step 1:** Add the three collections to `SYNC_COLLECTIONS` (**exact strings**: `personaAvatars`, `artefacts`, `attachments`) and the types above. `PADDED_COLLECTIONS` in `packages/crypto` is **untouched** (spec §5: unpadded by decision).
- [ ] **Step 2:** Failing test in `apps/sync-service/tests/push.test.ts`: a push with `collection: 'artefacts'` (and one `personaAvatars`) is accepted; before the shared-types change it returns the unknown-collection error.
- [ ] **Step 3:** Build shared-types (`pnpm --filter @chatsundere/shared-types build` — stale `dist/` causes phantom tsc errors), run sync-service tests → PASS.
- [ ] **Step 4: Commit:** `03: Add blob wire types and admit the three blob collections to the sync allowlist`

---

### Task 3: sync-service env + MinIO in dev compose

**Files:**
- Modify: `apps/sync-service/src/env.ts`, `apps/sync-service/tests/env.test.ts`
- Modify: `infra/compose.dev.yml`
- Modify: `apps/sync-service/.env.example` (or the repo's env-example location for the service — match where 6B put it)

**Interfaces (Produces):** `env.S3_ENDPOINT?: string`, `env.S3_REGION`, `env.S3_BUCKET`, `env.S3_ACCESS_KEY_ID?`, `env.S3_SECRET_ACCESS_KEY?`, `env.S3_FORCE_PATH_STYLE: boolean`, `env.MAX_BLOB_BYTES`, `env.BLOB_QUOTA_FLOOR_BYTES`, `env.BLOB_UPLOAD_IDLE_TIMEOUT_S`, plus `blobsEnabled(env): boolean` (true iff `S3_ENDPOINT` set).

- [ ] **Step 1: failing env tests:** defaults per spec §14 (`MAX_BLOB_BYTES` 33554432, `BLOB_QUOTA_FLOOR_BYTES` 65536, `BLOB_UPLOAD_IDLE_TIMEOUT_S` 30, `S3_REGION` 'us-east-1', `S3_BUCKET` 'chatsundere-blobs', `S3_FORCE_PATH_STYLE` true); `S3_ENDPOINT` set but credentials missing → env load throws; `blobsEnabled` false when `S3_ENDPOINT` unset. **`ACCOUNT_QUOTA_BYTES` default changes to `2147483648`** (spec §2.3) — update the existing default assertion.
- [ ] **Step 2:** Implement in `env.ts` following the existing Valibot `num()` pattern; booleans via a `bool()` helper mirroring `num()`. Cross-field validation (endpoint ⇒ credentials) via `v.pipe(EnvSchema, v.check(...))`.
- [ ] **Step 3:** MinIO service in `infra/compose.dev.yml` following the postgres/redis style: `image: minio/minio:latest` pinned to the current stable tag, `command: ['server', '/data']`, dev-only credentials via `MINIO_ROOT_USER: chatsundere-dev` / `MINIO_ROOT_PASSWORD: chatsundere-dev-secret` (dev compose is secret-free by convention — these are lab values), volume `./data/minio:/data`, healthcheck `['CMD', 'curl', '-f', 'http://localhost:9000/minio/health/live']` (fall back to `mc ready local` if curl is absent in the image — probe 5 tells you), **no published console port**; API port published for local dev only (`127.0.0.1:9000:9000`), network `chatsundere-dev`.
- [ ] **Step 4:** Update `.env.example` with all new vars + one-line comments. Run env tests → PASS, `pnpm typecheck --force`.
- [ ] **Step 5: Commit:** `03: Add S3 configuration to sync-service env and MinIO to the dev compose`

---

### Task 4: `sync_blobs` schema + migration

**Files:**
- Modify: `apps/sync-service/src/db/schema.ts`, `apps/sync-service/src/db/migrations.ts`
- Test: `apps/sync-service/tests/db.test.ts` (extend)

**Interfaces (Produces):**
```ts
export const syncBlobs = pgTable('sync_blobs', {
  accountId: uuid('account_id').notNull(),
  blobId: text('blob_id').notNull(),
  bytes: bigint('bytes', { mode: 'number' }).notNull(),
  ciphertextHash: bytea('ciphertext_hash').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.accountId, t.blobId] })]);
```
(`created_at` is a deliberate, spec-justified exception to the no-timestamps rule — copy the spec §4 justification into a comment.)

- [ ] Failing test (plant + read back through the migrated test DB, PK violation on duplicate insert), migration following 6B's `migrations.ts` pattern, run `tests/db.test.ts` + full suite → PASS.
- [ ] **Commit:** `03: Add the sync_blobs metadata table`

---

### Task 5: S3 backend wrapper + bucket bootstrap

**Files:**
- Create: `apps/sync-service/src/blobs/s3.ts`
- Test: `apps/sync-service/tests/s3.test.ts` (against the dev MinIO; skip cleanly with a loud message when `S3_TEST_ENDPOINT` is unset, mirroring the `TEST_DATABASE_URL` pattern in `tests/helpers/test-db.ts`)

**Interfaces (Produces):**
```ts
export interface BlobBackend {
  putStream(key: string, body: ReadableStream<Uint8Array>, length: number): Promise<void>;
  getStream(key: string): Promise<{ stream: ReadableStream<Uint8Array>; length: number } | null>;
  delete(key: string): Promise<void>;              // idempotent; retries deletes with short backoff (spec §7.1)
  healthy(): Promise<boolean>;
}
export function createS3Backend(env: Env): BlobBackend;
/** Idempotent: creates the bucket if absent; warns loudly if versioning is enabled; sets the multipart-abort lifecycle rule if probe 1 showed multipart. Never throws on unreachable S3 (logs + returns false). */
export function bootstrapBucket(env: Env): Promise<boolean>;
export const blobKey = (accountId: string, blobId: string): string => `${accountId}/${blobId}`;
```

- [ ] Failing tests: put→get round-trip (streamed, byte-identical at 3 MiB), get of an absent key → null, delete idempotent, `healthy()` false on a closed-port endpoint, bootstrap idempotent twice, bootstrap-warning path with versioning enabled (enable via the client API in the test, if probe 5 showed it possible; otherwise assert the check call happens against a mock).
- [ ] Implement with the probe-1 winner. Wire `bootstrapBucket` into `apps/sync-service/src/index.ts` boot (non-blocking: failure logs + background retry every 30 s — records must serve regardless, spec §8).
- [ ] Full suite → PASS. **Commit:** `03: Add the S3 blob backend and bucket bootstrap`

---

### Task 6: blob store — DB transactions (quota under the lock)

**Files:**
- Create: `apps/sync-service/src/blobs/store.ts`
- Test: `apps/sync-service/tests/blob-store.test.ts`

**Interfaces (Produces):**
```ts
export type BlobCommitResult =
  | { status: 'created' }
  | { status: 'quota_exceeded'; usedBytes: number; quotaBytes: number };
/** Looks up a blob row. */
export function findBlob(db: Db, accountId: string, blobId: string):
  Promise<{ bytes: number; ciphertextHash: Uint8Array } | null>;
/** Commits an uploaded blob: FOR UPDATE on sync_accounts, re-verifies quota under the lock (floored), inserts the row, bumps total_bytes. */
export function commitBlob(db: Db, accountId: string, blobId: string, bytes: number,
  hash: Uint8Array, limits: { quotaBytes: number; floorBytes: number }): Promise<BlobCommitResult>;
/** DB-first delete: removes the row and credits the floored bytes; returns whether a row existed. */
export function deleteBlobRow(db: Db, accountId: string, blobId: string,
  floorBytes: number): Promise<{ existed: boolean }>;
export function listBlobs(db: Db, accountId: string):
  Promise<{ blobs: { blobId: string; bytes: number }[]; totalBytes: number }>;
export const flooredBytes = (bytes: number, floor: number): number => Math.max(bytes, floor);
```

- [ ] Failing tests (spec §18): commit + row + `total_bytes` bump (floored — a 1 KiB blob charges 65536); commit at exact fit passes, +1 byte → `quota_exceeded` with used/quota; **two concurrent `commitBlob` calls that each fit alone but not together → exactly one `created`, final `total_bytes ≤ quota`** (run in `Promise.all` against the real test DB — the lock serialises them); delete credits floored bytes and is idempotent; list is account-scoped (plant two accounts); a record-channel `applyBatch` and a `commitBlob` racing share the counter correctly (plant near-quota, race one of each, assert no overshoot).
- [ ] Implement mirroring `applyBatch`'s transaction/lock shape (same `onConflictDoNothing` account upsert, same `.for('update')`).
- [ ] Full suite → PASS. **Commit:** `03: Add the blob metadata store with locked quota enforcement`

---

### Task 7: the four blob routes

**Files:**
- Create: `apps/sync-service/src/routes/blobs.ts`
- Modify: `apps/sync-service/src/server.ts` (register), `apps/sync-service/src/http/deps.ts` (add `blobBackend: BlobBackend | null`)
- Test: `apps/sync-service/tests/blob-routes.test.ts`

**Interfaces (Consumes):** Tasks 2/3/5/6. **Produces:** `registerBlobRoutes(app: Hono, deps: SyncDeps)` mounting `PUT/GET/DELETE /api/v1/sync/blobs/:blobId` + `GET /api/v1/sync/blobs`.

**The PUT pipeline is spec §7.1 verbatim — implement the steps in its exact order** (validation → length window [28 B ≤ n ≤ `MAX_BLOB_BYTES`] → **existence before quota pre-check** → floored quota pre-check → stream-with-hash/count/inactivity-watchdog → `commitBlob` with the locked re-check). Key mechanics:

```ts
const BLOB_ID_RE = /^[A-Za-z0-9_-]{22}$/;
// stream + hash + count, abort on: over-length, stall (BLOB_UPLOAD_IDLE_TIMEOUT_S), disconnect
const hasher = new Bun.CryptoHasher('sha256');   // per probe 2
```
On any post-stream failure: best-effort S3 delete (the backend's retrying delete), no DB write, error per §7.5 (statuses **verbatim**: 413 `blob_too_large` with `maxBlobBytes`, 507 `quota_exceeded`, 409 `blob_exists`, 400 `hash_mismatch`, 404 `not_found`, 429 `delete_rate_limited` + `Retry-After`, 503 `blob_backend_unavailable`, 501 `blobs_disabled`, 411 missing length). GET streams with `Content-Length`, `Cache-Control: no-store`, incremental hash → inconsistency metric on mismatch (spec §7.2). DELETE: shares the tombstone window — consume 1 from the **same** limiter key `applyBatch`'s `deleteAllowance` uses (read `routes/changes.ts` to find the key construction and reuse it exactly); DB-first, S3 after (spec §7.3). List returns `BlobListResponse` (quota from env). **Do NOT wrap blob routes in the `bodyLimit` middleware** used by the push route (spec §7.1 exemption) — assert in review that `registerBlobRoutes` mounts before/outside any service-wide body limit.

- [ ] Failing tests — the spec §18 "PUT"/"GET"/"DELETE"/"Listing"/"Shared quota"/"Auth matrix" bullets are the test list; implement them literally. The ones that must not be skipped: idempotent re-PUT at a **full** account → 200; >24 MiB <32 MiB PUT succeeds (`MAX_BODY_BYTES` exemption); cross-account GET/DELETE → 404/204-without-effect; mixed record-tombstone + blob-DELETE tripping one window; `blobs_disabled` when `S3_ENDPOINT` unset (deps.blobBackend null); `blob_backend_unavailable` when `healthy()` is false / backend throws, with a record push still green in the same test.
- [ ] Implement; full suite → PASS. **Commit:** `03: Add the blob transport routes`

---

### Task 8: metrics + anonymity

**Files:**
- Modify: `apps/sync-service/src/metrics.ts`, `apps/sync-service/src/routes/blobs.ts` (instrument), `apps/sync-service/src/logger.ts` (extend redact list with `S3_ACCESS_KEY_ID`/`S3_SECRET_ACCESS_KEY` paths)
- Test: extend `apps/sync-service/tests/anonymity.test.ts`, `apps/sync-service/tests/ops.test.ts`

New metrics (naming mirrors the existing `sync_*` scheme): `sync_blob_uploads_total{outcome}`, `sync_blob_downloads_total{outcome}`, `sync_blob_deletes_total`, `sync_blob_bytes` (histogram), `sync_blob_backend_errors_total`, `sync_blob_backend_up` (gauge), `sync_blob_inconsistency_total`.

- [ ] Failing tests: metrics appear on `OPS_PORT` only; **no metric label and no log line contains an account id or blob id** (drive a full PUT/GET/DELETE cycle, scrape, scan); **a failing S3 call fed through the logger leaks neither endpoint credentials nor access-key id** (point the backend at a closed port, trigger, capture pino output, scan for the configured key material — spec §18 `[L]`).
- [ ] Implement; full suite → PASS. **Commit:** `03: Instrument the blob transport, ciphertext-blind`

---

### Task 9: allowlist round-trip + avatar lifecycle tests (record channel)

**Files:**
- Test: `apps/sync-service/tests/blob-collections.test.ts`

No production code — Task 2 admitted the collections; this pins the behaviour (spec §18 "Allowlist"/"Avatar lifecycle"):

- [ ] Sealed `personaAvatars` row keyed by `personaId` round-trips push→pull (use `sealRecord` from `@chatsundere/crypto` with a fixture row carrying `blobRef: { blobId, bytes }`); same for an `artefacts` row with `blobRef` + `thumbBlobRef` and an `attachments` row. Assert the sealed wire payload is **small** (refs, not image bytes — size < 4 KiB for a fixture with a nominal 5 MiB `bytes` value). Avatar lifecycle: insert → Class-2 update to `blobRef: null` (plain CAS update, **no tombstone**) → update back to a new ref → pulls reflect each state; a genuine tombstone (persona deletion) stays terminal for that `blind_id`.
- [ ] **Commit:** `03: Pin blob-collection record semantics and the avatar cleared-state lifecycle`

---

### Task 10: `re-epoch` command

**Files:**
- Create: `apps/sync-service/tools/re-epoch.ts`
- Test: `apps/sync-service/tests/re-epoch.test.ts` (extract the core into `src/db/epoch.ts` if `migrations.ts` doesn't already expose epoch helpers — test the function, not the CLI wrapper)

- [ ] Failing test: `reEpoch(db)` replaces the single `sync_meta` row with a fresh uuid; the value the server would read at boot changes.
- [ ] Implement (`DELETE FROM sync_meta; INSERT ... DEFAULT VALUES` in one transaction, print old → new). CLI usage line: `bun tools/re-epoch.ts` with `DATABASE_URL` set, plus a `--yes` confirm gate (it invalidates every client's watermark — say so in the output).
- [ ] Full suite → PASS. **Commit:** `03: Add the re-epoch command for operator restores`

---

### Task 11: auth-service `"blobs"` config flag

**Files:**
- Modify: `apps/auth-service/src/env.ts` (add optional `SYNC_BLOBS_ENABLED`, boolean-string like the service's existing flags), `apps/auth-service/src/routes/config.ts`
- Test: extend the auth-service config route test (find it via `rg -l "syncUrl" apps/auth-service/tests`)

- [ ] Failing tests: `SYNC_BLOBS_ENABLED=true` **and** `SYNC_PUBLIC_URL` set → `features` includes `"blobs"` (after `"sync"`); flag unset or false → absent; flag true but `SYNC_PUBLIC_URL` unset → absent (blobs without sync is meaningless — pin that).
- [ ] Implement (3 lines in `config.ts` following the existing `SYNC_PUBLIC_URL` branch), update auth-service `.env.example`. Full auth suite → PASS.
- [ ] **Commit:** `03: Advertise the blobs feature via backend discovery`

---

### Task 12: seal-cli blob subcommands

**Files:**
- Modify: `apps/sync-service/tools/seal-cli.ts`
- Test: extend `apps/sync-service/tests/e2e.test.ts` OR a new `tests/blob-e2e.test.ts` (next task) — the CLI functions should be exported for reuse

- [ ] Add `blob-seal --mk <b64url> --in <file> [--blob-id <id>] --out <file>` (mints an id when not given; prints `blobId` and `x-ciphertext-hash` b64url) and `blob-open --mk <b64url> --blob-id <id> --in <file> --out <file>`, following the existing `seal`/`open` command structure and arg parsing exactly. Update the CLI usage text.
- [ ] Manual smoke: seal → open → `cmp` byte-identical. **Commit:** `03: Add blob subcommands to the seal CLI`

---

### Task 13: cross-channel e2e

**Files:**
- Test: `apps/sync-service/tests/blob-e2e.test.ts`

- [ ] The spec §15 wire flow as one test file against a real server instance (the `e2e.test.ts` harness pattern): seal a real image fixture (any small PNG committed under `tests/fixtures/`) → PUT device 1 → `201` → re-PUT → `200` → GET device 2 → `openBlob` → byte-identical → listing shows it with shared totals → push records until the shared quota trips (small quota via env override) → `507` names used/quota → DELETE → `204` → GET `404` → listing freed. Plus: deny-listed token → `401` on PUT/GET within the same second (reuse the revocation test helpers).
- [ ] **Commit:** `03: Add the blob transport end-to-end suite`

---

### Task 14: prod compose example + env documentation

**Files:**
- Modify: `infra/compose.prod.yml.example` (MinIO service: internal network **only**, no published ports at all, named volume, healthcheck, `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD` from env with **placeholder values that force a change** — e.g. `CHANGE-ME`; a commented note on creating the scoped access key for sync-service), sync-service + auth-service service blocks gain the new env vars
- Modify: root `README.md` env-var table if 6B maintains one (check; otherwise skip — DEPLOYMENT.md is the reference)

- [ ] `docker compose -f infra/compose.prod.yml.example config` parses. **Commit:** `03: Add MinIO to the production compose example [skip ci]`

---

### Task 15: `obsidian/DEPLOYMENT.md`

**Files:**
- Create: `obsidian/DEPLOYMENT.md`

Written LAST, against the **built** services (spec §17: empirical truth — every env var name, default, and behaviour claim is verified against the code produced above, not against the spec). The chapter structure is spec §17's ten chapters **verbatim** — copy the chapter list from the spec and write each. Non-negotiables per spec: ch. 2 (zero-knowledge posture) leads honestly including the §6 traffic-shape residue; ch. 3 includes image provenance + build-from-source; ch. 4 is congruent with every `.env.example` (list-diff them as a self-check) and names the `SYNC_BLOBS_ENABLED`/`S3_ENDPOINT` pairing as a congruence checkpoint; ch. 7 includes the **restore runbook with the `re-epoch` step** and the retention/orphan honesty; ch. 8 single-replica honesty; ch. 10 includes the five MinIO-specific items (no console/API port published, no default root creds, scoped access key, versioning/ILM off-or-documented, audit-log implications). British English, deredere towards operators — every chapter ends in a constructive next step, never a gate.

- [ ] Write it, self-check ch. 4 against the `.env.example`s, **Commit:** `03: Add the operator deployment reference [skip ci]`

---

### Task 16: final gates

- [ ] `pnpm typecheck --force` — 14/14, 0 cached.
- [ ] `cd apps/sync-service && bun test` — full suite green (records + doorbell + blobs).
- [ ] `cd apps/auth-service && bun test` — green.
- [ ] packages/crypto test suite — green.
- [ ] Biome clean on all changed files.
- [ ] `git log --oneline` — one `03: ` commit per task, no scratch files staged (`git diff origin/master --name-only` shows no `.superpowers`/report pollution).

---

## Manual verification (Chris, VPS dry-run — spec §20 verbatim)

The ten §20 steps, run on the staged compose. Not automatable; listed in the spec.

## Deviation rule

If a probe result or an implementation reality contradicts the spec, STOP on that task, record the contradiction in the probe README / commit message, choose the smallest spec-consistent resolution, and flag it in the final report. Never silently diverge from spec §7.1's pipeline order, §7.5's statuses, or the §5 crypto pins.
