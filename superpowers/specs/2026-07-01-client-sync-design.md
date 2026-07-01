# Client Sync — `sync-service` + sync envelope (design)

**Date:** 2026-07-01
**Author:** Liz (with Chris)
**Status:** Draft — awaiting Larissa spec-pass (security) + a second
protocol/functional cross-review, then Chris's spec review, then the
implementation plan. Built by overnight remote execution on
**`feat/backend-02-sync`**, sequenced **after** the proxy run has merged to
master (it extends `GET /api/v1/config`, which the proxy workstream creates).
**Larissa re-audits the built diff before squash** (touches
`apps/sync-service`, `packages/crypto`, and a small `apps/auth-service`
addition). **Scope:** the sync **server** (`apps/sync-service` over the Phase-0
skeleton), the **sync record envelope** in `packages/crypto`, the wire types in
`packages/shared-types`, and the `/api/v1/config` extension. The **client sync
engine** (Dexie v31, outbox, worker, connectivity gating) is **out of scope
here** — designed as a contract in §12, built in a later inline session with
Chris + Laura (§16).

This spec consolidates the settled decisions in
`BACKEND-ANALYSIS-cors-proxy-and-sync.md` (§0, §2, §5, and the deep-dive
session of 2026-06-30) plus three refinements agreed with Chris on 2026-07-01:
the **state-store framing** (§4), the **single data path** (pull-only delivery,
§7.3), and the **doorbell socket lifetime bound to the access-token TTL**
(§8.4). It is zero-knowledge-critical — the one workstream where a design
mistake breaks the product's central promise.

---

## 1. Why

Chatsundere is local-first and feature-complete on one device. What it cannot
yet do is the headline promise of the backend: **a user is themselves on every
device, and device loss is not data loss** — while the server remains
zero-knowledge (CLAUDE.md §3.1). Auth is done (OPAQUE, passkey+PRF, pairing,
recovery — the MK already travels to a new device); what is missing is the
data: an encrypted, blind-indexed store the clients converge through.

The server side of this is deliberately dumb: it stores ciphertext it cannot
read, addressed by tokens it cannot reverse, ordered by a counter it assigns.
Every merge, every decrypt, every conflict resolution happens on an unlocked
client. This spec builds that dumb server properly — plus the client-side
crypto envelope it stores — and pins the contract the client engine will be
built against.

## 2. Guiding principles (settled with Chris)

1. **Zero-knowledge, mechanically enforced.** The server never sees a key, a
   plaintext row, a real uuid, or a content timestamp. Everything it enforces
   (ordering, conflicts, tombstones, quotas) is enforceable without knowing
   what a record *is*.
2. **A state store with a rev watermark, not an oplog.** The server keeps only
   the **latest** ciphertext per record; an update overwrites the old blob
   under a fresh per-account `rev`. Storage stays bounded, and
   `pull since rev X` still yields exactly "everything that changed since your
   last stand". A new device pulling from `since=0` receives the full state
   through the same path — onboarding is not a special case.
3. **One data path.** The pull is the **only** way data reaches a device. The
   doorbell (§8) carries a bare `rev` and means nothing but "pull now"; the
   push response carries `head` and means nothing but "you are behind — pull".
   No second delivery mechanism to test, secure, or reason about.
4. **Padding where the sidechannel is real — the rest is owned.** Persona
   records and memory are size-padded because their size alone reads as "an
   intensively used companion with elaborate custom instructions" (§6). The
   residual metadata (collection tag, per-type counts, receipt order, sizes
   elsewhere) is **consciously accepted per Chris's threat assessment
   (2026-07-01)** — a decision with a rationale, not a gap.
5. **Delete is dignified, everywhere.** A tombstone is terminal for its
   `blind_id` and the server **nulls the ciphertext** — the content is gone,
   not flagged. A racing edit never resurrects a shame-delete, and the server
   enforces that without knowing what was deleted.
6. **Hardening is inherited, not reinvented.** JWKS resource-server
   verification, trusted-hop client IP, fail-closed rate limits, the ops-port
   split, and anonymous-only metrics are taken 1:1 from the proxy spec
   (`2026-07-01-authenticated-cors-proxy-design.md` §4, §5.4, §8) and only
   deviations are stated here.

## 3. Architecture overview

A Hono-on-Bun service. Postgres (Drizzle) for records, Redis for rate limits +
the doorbell pub/sub. Two ports, exactly like the proxy:

- **`PORT` (public, Traefik-routed):** the sync API (§7, §8) under
  `/api/v1/sync/*`, CORS-restricted to the app origin(s).
- **`OPS_PORT` (internal, never Traefik-routed):** `/healthz`, `/readyz`,
  `/metrics`.

Per request: derive client IP from the trusted hop → per-IP rate limit
(pre-auth) → verify account JWT (JWKS, cached) → per-user rate limit → handle.
Same order and same rationale as the proxy spec §3.

New source layout (over the skeleton `env.ts`/`metrics.ts`/`logger.ts`/
`server.ts`/`routes/health.ts`):

- `src/auth/verify-token.ts` — JWKS verification (shared shape with the proxy;
  pinned `EdDSA`, exact `iss`, 5 s tolerance, hardened `jose` fetch options).
- `src/db/schema.ts` + `src/db/migrations/` — Drizzle schema (§4).
- `src/records/store.ts` — the CAS write path, tombstone terminality, quota
  accounting (§4, §7).
- `src/records/collections.ts` — the collection allowlist (§5.4).
- `src/routes/changes.ts` — push + pull handlers (§7).
- `src/routes/doorbell.ts` — ticket mint + WebSocket upgrade (§8).
- `src/doorbell/hub.ts` — the Redis subscriber + per-account socket registry (§8).
- `src/ratelimit/limiter.ts`, `src/net/client-ip.ts`, `src/cors.ts`,
  `src/error.ts`, `src/ops.ts` — inherited proxy patterns.

In `packages/crypto`: `src/sync-envelope.ts` (§5) — pure functions, no I/O.
In `packages/shared-types`: `src/sync.ts` — wire types + error codes (§7, §13).

## 4. Server data model

One record table plus a per-account head:

```
sync_records
  account_id       uuid        (from the JWT `sub`; composite PK with blind_id)
  blind_id         bytea(16)   (HMAC token, §5.1)
  collection       text        (cleartext by decision; validated against §5.4)
  rev              bigint      (per-account monotonic; assigned by the server)
  deleted          boolean     (tombstone flag)
  nonce            bytea(12)   (NULL on tombstones)
  ciphertext       bytea       (NULL on tombstones — content truly gone)
  ciphertext_hash  bytea(32)   (SHA-256 of ciphertext; NULL on tombstones)

  PRIMARY KEY (account_id, blind_id)
  INDEX (account_id, rev)

sync_accounts
  account_id   uuid PRIMARY KEY
  head_rev     bigint      (the account's high-water mark)
  total_bytes  bigint      (quota accounting, §7.4)
```

- **`rev` is a per-account counter, not a global sequence.** A global sequence
  would let every client infer server-wide activity from the gaps in its own
  revs — a small leak, but we hold the Proton bar. `head_rev` is bumped inside
  the write transaction (`SELECT … FOR UPDATE` on the `sync_accounts` row);
  each accepted record gets its own rev, so pull ordering is total.
- **No timestamp columns — deliberately.** The server needs none (rev is the
  order), and even server-side receipt times are metadata we can simply not
  have. Ops debugging gets metrics, not per-row times.
- **Write semantics, mechanically enforceable without content knowledge:**
  1. **Insert** (`baseRev = 0`): create if absent, assign a fresh rev. If a
     record already exists under that `blind_id` → `conflict` with the current
     record (two devices minted the same entity — only possible via replay of
     the same uuid, and the client resolves idempotently).
  2. **Update** (`baseRev = n`): compare-and-swap. Current rev ≠ `baseRev` →
     `conflict` with the current record; the client resolves (LWW on the
     decrypted content `updatedAt`, §12.3) and re-pushes.
  3. **Delete**: **unconditional — deletes skip CAS.** Delete-always-wins
     (deep-dive decision A) means a stale `baseRev` must not stop a tombstone.
     Sets `deleted = true`, nulls `nonce`/`ciphertext`/`ciphertext_hash`,
     assigns a fresh rev. Deleting an absent record **creates** the tombstone
     (the create may not have synced yet — terminality must still hold).
     Deleting a tombstone is idempotent: returns the existing rev, no head
     bump, no doorbell.
  4. **Tombstone terminality:** any insert or update against a tombstoned
     `blind_id` → per-record `tombstoned` outcome carrying the tombstone; the
     client discards its local copy. A re-created entity has a new uuid and
     therefore a new `blind_id` — never suppressed (ADR 0025).
- **Quota accounting:** `total_bytes` tracks the sum of stored ciphertext
  bytes, updated by delta in the same transaction (a tombstone frees its
  bytes).

## 5. The record envelope and the blind index (`packages/crypto`)

A new pure module `sync-envelope.ts`, exercising the existing primitives
(`deriveDek`, WebCrypto AES-GCM) — no new key material classes, no I/O,
fully unit-testable. This is the zero-knowledge-critical code.

### 5.1 Blind index

```
blindIndexKey = deriveDek(mk, 'sync/blind-index-v1')
blind_id      = HMAC-SHA256(blindIndexKey, utf8(collection) || 0x00 || utf8(key))[0..16]
```

- `key` is the row's primary key serialised as a string (uuidv7 for every
  collection except `settings`, whose singleton key is the literal `"1"`).
- Deterministic: same entity → same `blind_id` on every device of the account,
  so upserts are idempotent and the ADR 0025 "same uuid = same entity" merge
  rule survives blinding.
- The **uuidv7 never leaves the device in cleartext** — its embedded 48-bit
  creation timestamp is exactly the metadata the blind index exists to hide.
- The `0x00` separator prevents collection/key boundary shifts
  (`"chat"+"s123"` vs `"chats"+"123"`).
- 128-bit truncation: collision probability is negligible at any realistic
  record count, and the token stays compact.

### 5.2 Sealing

```
key        = deriveDek(mk, 'sync/collection/<collection>-v1')
plaintext  = u32-LE length prefix || JSON(row) || zero padding (§5.3)
nonce      = 12 random bytes (fresh per seal, never reused)
aad        = utf8('chatsundere-sync-v1') || utf8(collection) || blind_id
ciphertext = AES-256-GCM(key, nonce, plaintext, aad)
```

The AAD does three jobs: a blob cannot be replayed under a **different
blind_id** (anti-swap — the same discipline as `sealSecret`'s slot binding), it
cannot be moved to a **different collection**, and a future envelope v2 cannot
be confused with v1. `openRecord` additionally recomputes the blind index from
the decrypted row's key and requires it to match the `blind_id` the record was
fetched under — belt and braces on top of GCM.

Exports (names indicative): `computeBlindId(mk, collection, key)`,
`sealRecord(mk, collection, row)` →
`{ blindId, nonce, ciphertext, ciphertextHash }`, and
`openRecord(mk, collection, blindId, { nonce, ciphertext })` → row. All
parent/child pointers (`chatId` on a message, `personaId` on a chat) live
inside the ciphertext; the server never reconstructs the graph.

### 5.3 Padding — where the sidechannel is real

`personas`, `memoryBody`, and `memoryJournal` plaintexts are padded to the
next **power-of-two bucket starting at 1 KiB** (1 → 2 → 4 → 8 → 16 KiB …)
before sealing. Rationale (deep-dive decision, reaffirmed 2026-07-01): blob
size on these three collections reads as "elaborate custom instructions and a
lot of memory" — an intensity-of-use inference worth blunting. The u32 length
prefix makes unpadding trivial and deterministic. **No other collection is
padded in v1**, by decision, not omission.

### 5.4 The collection allowlist

The server validates `collection` against a fixed set (bounding both storage
abuse and metric-label cardinality):

```
settings, providers, mcpServers, mindspaces, personas, chats, messages,
pills, artefacts, attachments, libraries, documents, vectors,
memoryJournal, memoryBody, compactionCheckpoints
```

Not in the set: `personaAvatars` (pure blob — joins with the blob transport,
§16), `voiceAudio` (transient LRU, never syncs). Device-local settings fields
(`settings.adultMode`, `settings.corsProxy`) are stripped client-side before
sealing (§12.5).

### 5.5 `ciphertext_hash`

SHA-256 over the ciphertext, computed client-side, verified server-side on
write (mismatch → per-record `hash_mismatch` error). Cheap, leaks nothing new
(the server holds the ciphertext anyway), and gives the ADR 0026 handover its
"did I receive everything?" completeness check later.

## 6. Threat-model position — what the server still sees

Stated so the boundary of the promise is auditable, not implied. With this
design the server (and anyone with its database) still learns:

- that an account exists, **how many** records of which **collection** it has,
  and their **sizes** (except the padded three),
- the **server-receipt order** (`rev`) — not the user's content timestamps,
- **which** records were deleted (as opaque tokens) and when in rev-order.

**Chris's explicit call (2026-07-01): this residue is immaterial under our
threat model.** The attacks that matter (operator or DB-thief reading
conversations, custom instructions, identities, NSFW status; correlating
content timestamps) are all closed by the envelope; the intensity-of-use
inference is closed by §5.3 padding exactly where it bites. Consciously **not**
built in v1: blinding the collection tag, padding everything, cover traffic.
The **NSFW/adult flag is a hard invariant**: it lives inside ciphertext only
and must never become a server-visible column or wire field — invariant-tested
(§17) so no future "index by nsfw" shortcut can creep in.

The live-inference path (the CORS proxy) remains a separate trust domain with
its own honest story — proxy spec §2.2. Sync is the zero-knowledge path.

## 7. Protocol — push and pull

Two endpoints. JSON wire; binary fields (`blindId`, `nonce`, `ciphertext`,
`ciphertextHash`) are base64url strings.

### 7.1 Push

```
POST /api/v1/sync/changes
Authorization: Bearer <account access JWT>
{ "records": [
    { "blindId": "…", "collection": "chats", "baseRev": 17,
      "deleted": false, "nonce": "…", "ciphertext": "…",
      "ciphertextHash": "…" },
    …
] }

200 { "head": 4710,
      "results": [
        { "status": "ok", "rev": 4710 },
        { "status": "conflict", "current": { …full record… } },
        { "status": "tombstoned", "current": { …tombstone… } },
        { "status": "error", "code": "record_too_large" },
        …
] }
```

- **Per-record atomic, never all-or-nothing.** Conflicts are normal operation;
  a `conflict` on record 3 must not roll back records 1–2. One database
  transaction processes the batch in order and collects per-record outcomes;
  `results[i]` corresponds to `records[i]`.
- Request **shape** violations (malformed JSON, unknown fields, over
  `MAX_PUSH_RECORDS`) → whole-request `400`. **Semantic** outcomes (conflict,
  tombstoned, too large, quota, hash mismatch, unknown collection) →
  per-record `results` entries.
- `conflict`/`tombstoned` return the **full current record** so the client can
  resolve without an extra round trip.
- Tombstone pushes (`deleted: true`) omit `nonce`/`ciphertext`/
  `ciphertextHash` and ignore `baseRev` (§4 — deletes skip CAS).

### 7.2 Pull

```
GET /api/v1/sync/changes?since=<rev>&limit=<n>
Authorization: Bearer <account access JWT>

200 { "head": 4711, "more": false,
      "records": [ { "blindId": "…", "collection": "…", "rev": 4708,
                     "deleted": false, "nonce": "…", "ciphertext": "…",
                     "ciphertextHash": "…" }, … ] }
```

Records with `rev > since`, ascending, up to `limit` (default 200, max 500);
`more` signals another page. `since=0` is the full-state pull — new-device
onboarding and the ADR 0026 handover sync-down are this same call, paged and
progress-barred by the client.

### 7.3 The piggyback, reduced to one data path

The push response carries `head`. If `head` exceeds the client's watermark
plus its own just-assigned revs, another device has written — the client
reacts by **pulling**. The analysis' original idea (push response returns the
caller's unseen changes) is deliberately reduced to this: returning data on
push would create a second delivery path duplicating pull's semantics.
One path, one set of tests.

### 7.4 Quotas and ceilings

- `MAX_RECORD_BYTES` (default 1 MiB of ciphertext) — over → per-record
  `record_too_large`.
- `ACCOUNT_QUOTA_BYTES` (default 1 GiB) — a push that would exceed it →
  per-record `quota_exceeded`; the error payload includes `usedBytes` and
  `quotaBytes` so the client can tell the user constructively.
- `MAX_PUSH_RECORDS` (default 100) and `MAX_BODY_BYTES` (default 24 MiB) —
  request-shape ceilings → `400`/`413`.
- Rate limits per user and per IP as in the proxy (§10.1).

## 8. The doorbell — a contentless WebSocket poke

The doorbell accelerates convergence; it is **not** a data path. The pull
engine works identically with the socket absent, blocked, or broken.

### 8.1 Ticket handshake

Browsers cannot set headers on a WebSocket upgrade, and a JWT in a URL is a
classic log leak. So:

```
POST /api/v1/sync/doorbell-ticket        (JWT-authenticated)
200 { "ticket": "<opaque random 32 B, base64url>" }

GET /api/v1/sync/doorbell?ticket=…       → 101 WebSocket upgrade
```

The ticket lives in Redis (`sync:ticket:<ticket>` → `{ accountId, exp }`,
**30 s TTL, single-use via GETDEL** — the same atomicity discipline as the
step-up round state). It stores the *token's* remaining lifetime, so the
socket inherits the access token's expiry (§8.4). An invalid/expired/reused
ticket → upgrade refused with `4401` close (or plain `401` pre-upgrade).

### 8.2 Server behaviour

On every accepted push batch the write path `PUBLISH`es the new `head` to the
Redis channel `sync:<account_id>` — **once per batch, not per record**. The
doorbell hub holds one multiplexed Redis subscriber connection,
`SUBSCRIBE`/`UNSUBSCRIBE`-ing per-account channels as sockets come and go, and
forwards to each of the account's sockets:

```
{ "rev": 4711 }
```

Never anything else — no collection, no blind_id, no count. The client's sole
reaction is "pull now". A mis-routed or spoofed poke can cause at most one
redundant pull; it leaks nothing and costs nothing.

### 8.3 The pusher hears its own bell

The pushing device receives its own poke; its pull is watermark-guarded and
cheap (§12.2). Not worth suppressing.

### 8.4 Lifetime = the access token's remaining TTL — a deliberate double win

The server closes the socket when the token the ticket was minted from would
expire (≤ 15 min, `ACCESS_TTL`); the client obtains a fresh ticket and
reconnects with jittered backoff. Two things fall out of one rule: the
doorbell inherits **the same revocation boundary** as every other surface (a
logged-out device loses its bell within one token TTL — same 15-minute owned
window as the proxy, §9), and the forced reconnect is a built-in **dead-man's
switch** — no socket can be silently dead (half-open TCP, broken middlebox)
for longer than 15 minutes, guaranteeing the doorbell is genuinely connected
without a bespoke heartbeat protocol. Per-account concurrent-socket cap
(default 8, in-process — single-replica scope, noted as such).

## 9. Authentication — inherited from the proxy, one deviation

Identical to proxy spec §4: resource-server JWKS verification with
`algorithms: ['EdDSA']` pinned, `iss` exactly **`chatsundere-auth-v1`** (the
skeleton's `chatsundere-auth` default is wrong — same bug the proxy corrected;
fix `env.ts` and `.env.example`), `exp` with 5 s tolerance, `aud` declared but
ignored (variant a), hardened `jose` fetch options, JWKS failure → `401` fail
closed.

**Deviation — none in behaviour, one in emphasis:** sync stores per-account
state, so the deferred `jti`/suspension check matters more here than on the
proxy — a suspended user keeps pushing/pulling for up to 15 minutes. Owned,
same as the proxy; the device/session-management workstream (analysis §3.1)
brings the revocation hook for both services at once. The `aud`-ignore
forward-guard from the proxy spec applies verbatim: revisit the moment the
auth-service mints a second EdDSA token type under the same issuer.

## 10. Hardening & observability

### 10.1 Rate limits, client IP, CORS

- Client IP from the trusted-proxy hop (`TRUST_PROXY_HOPS`/
  `TRUSTED_PROXY_CIDR`), never a client-settable header; per-IP limit
  pre-auth, per-user post-auth; Redis sliding window, **fail closed**;
  `429` + `Retry-After`. All proxy-inherited.
- Defaults: per-user 120/min, per-IP 600/min (env-tunable). The doorbell
  ticket endpoint shares the per-user limit; upgrade attempts count against
  per-IP.
- **CORS here is conventional** (unlike the proxy, whose permissiveness is its
  purpose): exact-origin match against `CORS_ALLOWED_ORIGINS` (default
  `https://app.chatsundere.me`; dev adds localhost), reflected specific
  origin, `Vary: Origin`, no credentials (auth is a header, not a cookie).

### 10.2 Logging and metrics — anonymous, ciphertext-blind

- **No `account_id`, `sub`, `jti`, or `blind_id` in any log line or metric
  label, ever** — invariant-tested. Generic request logs (status, duration,
  route) are fine; the sensitive dimension is identity, and the payload is
  ciphertext by construction.
- Metrics (ops port): `sync_push_records_total{outcome}` (`ok, conflict,
  tombstoned, record_too_large, quota_exceeded, hash_mismatch,
  bad_collection`), `sync_pull_total`, `sync_pull_records_total`,
  `sync_doorbell_connections` (gauge), `sync_doorbell_pokes_total`,
  `sync_unauthorized_total`, `sync_rate_limited_total`, push/pull latency
  histograms, record-size histogram (bucketed — coarse by design).
  `collection` appears on **no** metric in v1 (per-collection counts are
  per-account-correlatable at our current account count; revisit when the
  cohort is large).

### 10.3 Ops split

`/healthz`, `/readyz` (checks Postgres + Redis), `/metrics` on `OPS_PORT`,
never Traefik-routed. Public port serves only `/api/v1/sync/*`.

## 11. Backend discovery — extending `GET /api/v1/config`

The proxy workstream creates the endpoint; this workstream (sequenced after
its merge) extends it:

```
GET /api/v1/config
200 { "proxyUrl": "…", "syncUrl": "https://sync.chatsundere.me",
      "features": ["proxy", "sync"] }
```

`SYNC_PUBLIC_URL` env var on the auth-service, validated at env-load as an
absolute `https` URL, same as `PROXY_PUBLIC_URL`. Unset → no `syncUrl` key and
no `"sync"` feature (an operator may run auth+proxy without sync); the client
drives "disabled over hidden" from `features`.

## 12. The client engine — the contract this server is built against

**Not built in the overnight run** (§16), but pinned here so the server
contract is verifiably sufficient. The later client session implements this
against the already-built, already-audited server.

### 12.1 The two write classes (analysis §2.4, unchanged)

- **Class 1 — append-only, offline-capable:** new `messages` rows (immutable
  once `streamingState: complete`), new `memoryJournal` entries, new
  `compactionCheckpoints`. Enqueued to `syncOutbox` in the **same Dexie
  transaction** as the local write; pushed as inserts (`baseRev: 0`)
  opportunistically. Set-union by uuid; conflict-free by construction.
- **Class 2 — mutating, online-required:** every edit/delete of an existing
  record, memory state transitions, memory-body creation, settings changes.
  Write-through: the local write settles only when the server acks the rev
  (the two-phase discipline already proven by the memory-body editor).
  Offline → disabled-with-reason, never hidden.

**Named resolution — the compaction pointer:** `writeCheckpoint` today appends
the checkpoint row (Class 1) *and* mutates `chat.activeCompactionId`
(Class 2). Overflow-failsafe compaction must work with the backend unreachable
(inference may flow directly or via proxy while sync is down), so the sync
engine **derives** the active pointer (latest checkpoint per chat, exactly
what `listCheckpoints`' `createdAt` sort already yields) instead of syncing
the chat-row edit. Checkpoint creation is then pure Class-1 append and the
failsafe never blocks on sync connectivity.

### 12.2 Watermark rules (the correctness-critical detail)

The client's high-water `rev` advances **only via pull**, page by page, to the
last record's rev of each page, looping while `more`. It must **never**
advance from push results: own revs may interleave with another device's
(push returns revs 10 and 12 while device B took 11 — jumping to 12 would
skip 11 forever). Pulls therefore re-deliver the client's own recent writes;
application is idempotent (upsert by the uuid inside the blob — a no-op when
the content matches). Echo-tolerance is a **required** engine property, tested
as such.

### 12.3 Conflict resolution (all client-side, deep-dive decisions A/C/E)

- **Delete always wins**, globally: a `tombstoned`/tombstone-pull discards the
  local row and any outbox entries for that uuid. Terminal per uuid.
- **Edit vs edit:** LWW on the decrypted content `updatedAt`, tie-break by
  uuid. Rare by construction (Class 2 is online-only).
- **`memoryJournal`:** set-union; state transitions are Class-2 edits.
- **`memoryBody`:** never merged — on divergence, discard the losing body and
  re-dream from the unioned journal (ADR 0031).
- **`settings`:** server wins, whole row, no field-level merge; a one-line
  honest note tells the user the account's settings apply.

### 12.4 Sync triggers

Timer + pull-on-foreground + push-piggyback `head` check + doorbell poke.
A single-flight worker (Web Locks, like the memory pipeline's guard) runs
whenever the session is unlocked and the backend reachable: drain outbox,
then pull-and-apply.

### 12.5 Device-local strip

Before sealing, the engine strips `settings.adultMode` and
`settings.corsProxy` (device-local by prior decision); on open, missing fields
keep their local values. `voiceAudio` and the lazy-chat localStorage drafts
never enter the engine.

### 12.6 Out of the engine's v1 scope

Uplevelling (in-place merge, dual-MK re-seal window), the ADR 0026 handover
state machine, device management — all consume this same protocol later;
nothing in §4–§8 needs to change for them (the handover's completeness check
is `ciphertext_hash` + contiguous-page pulls).

## 13. Error handling

Whole-request errors are generic; per-record outcomes are constructive
(the *dere* way — every failure names the next step for the client to act on).

| Condition | Response |
|---|---|
| Per-IP limit (pre-auth) / per-user limit | `429` + `Retry-After` |
| Missing/invalid/expired token; JWKS failure | `401`, generic |
| Redis outage | `503`, fail closed |
| Malformed body, unknown field, > `MAX_PUSH_RECORDS` | `400` |
| Body > `MAX_BODY_BYTES` | `413` |
| Unknown `collection` | per-record `error`, `bad_collection` |
| Ciphertext > `MAX_RECORD_BYTES` | per-record `error`, `record_too_large` |
| Account over quota | per-record `error`, `quota_exceeded` + `usedBytes`/`quotaBytes` |
| `ciphertext_hash` mismatch | per-record `error`, `hash_mismatch` |
| CAS miss | per-record `conflict` + current record |
| Write to tombstoned `blind_id` | per-record `tombstoned` + tombstone |
| Doorbell ticket invalid/expired/reused | upgrade refused (`401` / close `4401`) |
| Pull `since` > `head` (client ahead of server?) | `400`, `bad_since` — signals a server-reset/restore; client re-syncs from 0 |

## 14. Configuration (env)

| Var | Service | Meaning |
|---|---|---|
| `DATABASE_URL` | sync | Postgres (own database, e.g. `sync_db`) |
| `REDIS_URL` | sync | rate limits + doorbell pub/sub + tickets |
| `AUTH_JWKS_URL` | sync | JWKS endpoint |
| `JWT_ISSUER` | sync | **default corrected to `chatsundere-auth-v1`** |
| `JWT_AUDIENCE` | sync | declared, explicitly ignored (variant a) |
| `CORS_ALLOWED_ORIGINS` | sync | exact origins, default `https://app.chatsundere.me` |
| `TRUST_PROXY_HOPS` / `TRUSTED_PROXY_CIDR` | sync | trusted front boundary |
| `RATE_LIMIT_USER_PER_MIN` / `RATE_LIMIT_IP_PER_MIN` | sync | defaults 120 / 600 |
| `MAX_RECORD_BYTES` | sync | default `1048576` (1 MiB ciphertext) |
| `ACCOUNT_QUOTA_BYTES` | sync | default `1073741824` (1 GiB) |
| `MAX_PUSH_RECORDS` | sync | default `100` |
| `MAX_BODY_BYTES` | sync | default `25165824` (24 MiB) |
| `PULL_LIMIT_DEFAULT` / `PULL_LIMIT_MAX` | sync | defaults 200 / 500 |
| `DOORBELL_TICKET_TTL_S` | sync | default `30` |
| `MAX_SOCKETS_PER_ACCOUNT` | sync | default `8` (in-process, single-replica) |
| `PORT` / `OPS_PORT` | sync | public API / internal ops |
| `SYNC_PUBLIC_URL` | auth-service | value for `GET /api/v1/config`; absolute `https`, optional |

`.env.example` updated for both services; the test database follows the
auth-service `TEST_DATABASE_URL` isolation pattern.

## 15. Wire reference (concrete shapes for `curl`/`wscat` verification)

```
# Push (device 1)
curl -X POST https://sync.chatsundere.me/api/v1/sync/changes \
  -H 'Authorization: Bearer <JWT>' -H 'Content-Type: application/json' \
  -d '{"records":[{"blindId":"<b64url>","collection":"personas","baseRev":0,
       "deleted":false,"nonce":"<b64url>","ciphertext":"<b64url>",
       "ciphertextHash":"<b64url>"}]}'
# → {"head":1,"results":[{"status":"ok","rev":1}]}

# Pull (device 2, same account)
curl 'https://sync.chatsundere.me/api/v1/sync/changes?since=0&limit=200' \
  -H 'Authorization: Bearer <JWT2>'
# → {"head":1,"more":false,"records":[{…the same blob…}]}

# Doorbell
curl -X POST https://sync.chatsundere.me/api/v1/sync/doorbell-ticket \
  -H 'Authorization: Bearer <JWT2>'          # → {"ticket":"…"}
wscat -c 'wss://sync.chatsundere.me/api/v1/sync/doorbell?ticket=…'
# push again from device 1 → the socket receives {"rev":2}
```

## 16. Scope boundary — the seam

**IN (this spec, overnight remote execution, headless):**
- Full `sync-service`: schema + migrations, push/pull with CAS + tombstone
  terminality + quotas, doorbell (ticket + WSS + Redis pub/sub), JWKS auth,
  rate limits, CORS, ops split, anonymous metrics.
- `packages/crypto` `sync-envelope.ts` (blind index, seal/open, padding,
  hash) — pure, TDD-ideal.
- `packages/shared-types` sync wire types + error codes.
- The auth-service `/api/v1/config` extension (`syncUrl`, `"sync"` feature).
- Fully Bun-testable + `curl`/`wscat`-able (§15, §18). **Larissa re-audits
  the built diff before squash.**

**OUT (later sessions):**
- The client sync engine (§12) — Dexie v31 `syncOutbox`/`syncState`, worker,
  per-write-path outbox enqueue, connectivity gating. Invasive across the
  user-client's write paths; built inline (Liz) with Laura gating the UX.
- Uplevelling (in-place merge, dual-MK re-seal), the ADR 0026 handover
  machine, the device/session-management surface.
- Blob transport (S3): own follow-up spec. The envelope is blob-ready — blob
  references travel as content hashes inside ciphertext; `personaAvatars`
  joins the allowlist then.
- Vectors hybrid re-embed policy (client-side concern at sync-apply time).

## 17. Testing (Bun runner; crypto in the packages/crypto vitest suite)

- **Envelope:** seal/open round-trip per collection; padding bucket edges
  (1023/1024/1025 B → correct bucket, exact unpadding); nonce uniqueness
  across seals; AAD tamper matrix — foreign `blind_id`, foreign collection,
  v2 version tag each → decrypt failure; `openRecord` rejects a blob whose
  inner key does not re-HMAC to the fetched `blind_id`; deterministic
  `computeBlindId` across devices (same MK) and divergence across MKs.
- **NSFW invariant:** a full sealed wire payload for a `personas` /
  `libraries` row contains no `adultPersona`/`nsfw` bytes outside ciphertext
  (whole-wire scan, the transfer feature's discipline).
- **CAS matrix:** insert-on-absent ok; insert-on-present → conflict + current;
  stale/fresh `baseRev` update; delete with stale `baseRev` still wins; delete
  of absent record creates a terminal tombstone; delete idempotence (no head
  bump, no poke); insert **and** update against a tombstone → `tombstoned`;
  ciphertext/nonce/hash are `NULL` after tombstoning (content truly gone).
- **Rev semantics:** per-account monotonic, contiguous assignment within a
  batch; two accounts do not observe each other's revs; pull pagination
  (`more`, ascending order, `since` boundaries); `since > head` → `bad_since`.
- **Batch:** per-record outcomes positionally aligned; a conflict does not
  roll back neighbours; one doorbell publish per batch.
- **Quota/ceilings:** `record_too_large`, `quota_exceeded` (with
  used/quota payload), byte accounting across update (delta) and tombstone
  (freed); `MAX_PUSH_RECORDS`/`MAX_BODY_BYTES` → `400`/`413`.
- **Hash:** `ciphertext_hash` mismatch → per-record error, nothing stored.
- **Doorbell:** ticket single-use (second connect with the same ticket
  refused); expired ticket refused; poke carries only `{rev}`; socket closed
  at token expiry; per-account socket cap; a poke on account A never reaches
  account B's socket.
- **Auth matrix (proxy-inherited):** valid / expired / wrong-issuer /
  tampered / wrong-algorithm / absent → `401`; JWKS failure → `401`;
  pinned `EdDSA` + 5 s tolerance.
- **Rate limits:** spoofed `X-Forwarded-For` does not change the key; per-IP
  pre-auth, per-user post-auth; Redis outage → `503` fail closed.
- **Anonymity invariant:** no log line and no metric label contains
  `account_id`/`sub`/`jti`/`blind_id`; no `collection` metric label.
- **Ops split:** `/metrics` only on `OPS_PORT`.
- **Config:** `syncUrl` + `"sync"` present when `SYNC_PUBLIC_URL` set, both
  absent when unset; malformed value fails env-load.

## 18. Manual verification (Chris, on the VPS dry-run)

1. `docker compose up` (auth + proxy + sync + postgres + redis) →
   `docker compose ps` healthy; sync ops endpoints reachable only internally.
2. Register → tokens for "device 1" and "device 2" (same account).
3. §15 push from device 1 → pull from device 2 → the same blob returns;
   decrypt locally (a small script using `packages/crypto`) → the row is
   intact, uuid and timestamps inside.
4. Delete the record from device 2 → push an edit to the same `blindId` from
   device 1 → `tombstoned`, and the DB row shows `ciphertext IS NULL`.
5. `wscat` doorbell on device 2 → push from device 1 → `{"rev":…}` arrives
   within a second; reconnect with the same ticket → refused.
6. Push an over-quota / oversized record → constructive per-record error.
7. `GET /api/v1/config` → `proxyUrl`, `syncUrl`, `features:["proxy","sync"]`.
8. Internal `/metrics` → counters present, **no account/collection labels**.
9. `psql`: `sync_records` shows only ciphertext/blind tokens — no name, no
   uuid, no timestamp column anywhere.

## 19. Open points / deferred

- **`jti`/suspension revocation** — deferred with the device/session
  workstream; the 15-minute window is owned here exactly as on the proxy.
- **Tombstone retention** — tombstone rows live forever in v1 (terminality
  needs them). Revisit compaction (e.g. age-based pruning once every device
  has pulled past them) only if row counts ever matter.
- **Quota defaults** — 1 GiB/account, 1 MiB/record are first guesses; tune
  against real usage. The constructive `quota_exceeded` payload is the UX
  hook when a user hits it.
- **Per-collection metric labels** — reintroduce (bounded by §5.4) only when
  the account cohort is large enough that per-account correlation is moot.
- **Multi-replica** — socket caps and the doorbell registry are in-process;
  a second replica needs sticky sessions or a shared registry. Single-replica
  is the deployment reality for v1; noted, not built.
- **Blob transport** — own spec; §16.
- **Envelope `v2`** — the AAD version tag and per-collection DEK contexts
  (`-v1`) are the built-in migration seams if the envelope ever evolves.
