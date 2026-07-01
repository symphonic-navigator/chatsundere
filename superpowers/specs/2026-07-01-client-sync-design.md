# Client Sync — `sync-service` + sync envelope (design)

**Date:** 2026-07-01
**Author:** Liz (with Chris)
**Status:** Draft v2 — **Larissa spec-pass (security) + protocol/functional
cross-review complete (2026-07-01, both Fable-class); all findings folded in.**
Awaiting Chris's spec review, then the implementation plan. Built by overnight
remote execution on **`feat/backend-02-sync`**, sequenced **after** the proxy
run has merged to master (it extends `GET /api/v1/config`, which the proxy
workstream creates). **Larissa re-audits the built diff before squash**
(touches `apps/sync-service`, `packages/crypto`, and `apps/auth-service`).
**Scope:** the sync **server** (`apps/sync-service` over the Phase-0 skeleton),
the **sync record envelope** in `packages/crypto`, the wire types in
`packages/shared-types`, the token **revocation deny-list** (a small
auth-service addition + the sync-service check), and the `/api/v1/config`
extension. The **client sync engine** (Dexie v33, outbox, worker, connectivity
gating) is **out of scope here** — designed as a contract in §12, built in a
later inline session with Chris + Laura (§16).

This spec consolidates the settled decisions in
`BACKEND-ANALYSIS-cors-proxy-and-sync.md` (§0, §2, §5, and the deep-dive
session of 2026-06-30) plus refinements agreed with Chris on 2026-07-01: the
**state-store framing** (§4), the **single data path** (pull-only delivery,
§7.3), the **doorbell socket lifetime bound to the access-token TTL** (§8.4),
and — from the review round — **`jti`/`sub` revocation pulled into v1** (§9),
**`draftInput` demoted to device-local** (revising the analysis inventory),
**artefacts/attachments deferred to the blob transport**, and **vectors kept
in v1** with stamp-based adoption. Requirements are tagged `[L]` (Larissa) or
`[P]` (protocol/functional lens) where they exist specifically because of a
finding.

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
   records, memory, and seed templates are size-padded because their size
   alone reads as "an intensively used companion with elaborate custom
   instructions" (§6). The residual metadata (collection tag, per-type counts,
   receipt order, sizes elsewhere) is **consciously accepted per Chris's
   threat assessment (2026-07-01)** — a decision with a rationale, not a gap.
5. **Delete is dignified — and its blast radius is bounded.** A tombstone is
   terminal for its `blind_id` and the server **nulls the ciphertext** — the
   content is gone, not flagged. A racing edit never resurrects a
   shame-delete, and the server enforces that without knowing what was
   deleted. Because that same mechanism would otherwise hand an attacker an
   irreversible destruction primitive, three bounds apply: a per-account
   delete-rate ceiling (§7.4), token revocation in v1 (§9), and a client-side
   recoverable trash for *pulled* tombstones (§12.3) `[L]`. A user's own
   local delete remains immediate — dignity is not weakened.
6. **Honesty about the trust boundary.** The envelope guarantees
   **confidentiality** against the server. It does **not** guarantee
   availability or integrity-of-history: a malicious server can withhold,
   roll back, or destroy ciphertext (§6.2) `[L]`. Stating this plainly is the
   Proton bar; pretending E2EE covers it is not.
7. **Hardening is inherited, not reinvented.** JWKS resource-server
   verification, trusted-hop client IP, fail-closed rate limits, the ops-port
   split, and anonymous-only metrics are taken 1:1 from the proxy spec
   (`2026-07-01-authenticated-cors-proxy-design.md` §4, §5.4, §8); only
   deviations are stated here.

## 3. Architecture overview

A Hono-on-Bun service. Postgres (Drizzle) for records, Redis for rate limits,
the revocation deny-list, doorbell pub/sub, and doorbell tickets. Two ports,
exactly like the proxy:

- **`PORT` (public, Traefik-routed):** the sync API (§7, §8) under
  `/api/v1/sync/*`, CORS-restricted to the app origin(s).
- **`OPS_PORT` (internal, never Traefik-routed):** `/healthz`, `/readyz`,
  `/metrics`.

Per request: derive client IP from the trusted hop → per-IP rate limit
(pre-auth) → verify account JWT (JWKS, cached) → **revocation deny-list check
(§9)** → per-user rate limit → handle. Same order and rationale as the proxy
spec §3, with the deny-list check inserted directly after signature
verification.

New source layout (over the skeleton `env.ts`/`metrics.ts`/`logger.ts`/
`server.ts`/`routes/health.ts`):

- `src/auth/verify-token.ts` — JWKS verification (shared shape with the proxy;
  pinned `EdDSA`, exact `iss`, 5 s tolerance, hardened `jose` fetch options).
- `src/auth/revocation.ts` — the Redis deny-list check (§9) `[L]`.
- `src/db/schema.ts` + `src/db/migrations/` — Drizzle schema (§4).
- `src/records/store.ts` — the CAS write path, tombstone terminality, quota
  accounting, the batch transaction discipline (§4, §7).
- `src/records/collections.ts` — the collection allowlist (§5.4).
- `src/routes/changes.ts` — push + pull handlers (§7).
- `src/routes/doorbell.ts` — ticket mint + WebSocket upgrade (§8).
- `src/doorbell/hub.ts` — Redis subscriber, per-account socket registry,
  ping interval (§8.4) `[P]`.
- `src/ratelimit/limiter.ts`, `src/net/client-ip.ts`, `src/cors.ts`,
  `src/error.ts`, `src/ops.ts` — inherited proxy patterns.
- `tools/seal-cli.ts` — a tiny Bun CLI that seals/opens records with a given
  MK (mint, push, pull, open) so §15/§18 are actually executable by hand
  `[P]` — a real deliverable of the overnight run, not a footnote.

In `packages/crypto`: `src/sync-envelope.ts` (§5) — pure functions, no I/O.
In `packages/shared-types`: `src/sync.ts` — wire types + error codes (§7,
§13).
In `apps/auth-service`: deny-list writes on logout / session revocation /
suspension / account deletion (§9), and the `/api/v1/config` extension (§11).

## 4. Server data model

One record table, a per-account head, and a store identity:

```
sync_records
  account_id        uuid        (from the JWT `sub`; composite PK with blind_id)
  blind_id          bytea(16)   (HMAC token, §5.1)
  collection        text        (cleartext by decision; validated against §5.4)
  envelope_version  smallint    (cleartext discriminator, 1 for now — §5.2) [L]
  rev               bigint      (per-account monotonic; assigned by the server)
  deleted           boolean     (tombstone flag)
  nonce             bytea(12)   (NULL on tombstones)
  ciphertext        bytea       (NULL on tombstones — content truly gone)
  ciphertext_hash   bytea(32)   (SHA-256 of ciphertext; NULL on tombstones)

  PRIMARY KEY (account_id, blind_id)
  INDEX (account_id, rev)

sync_accounts
  account_id   uuid PRIMARY KEY
  head_rev     bigint      (the account's high-water mark)
  total_bytes  bigint      (quota accounting, §7.4)

sync_meta
  instance_epoch  uuid     (random, minted once at first migration) [P]
```

- **`rev` is a per-account counter, not a global sequence.** A global sequence
  would let every client infer server-wide activity from the gaps in its own
  revs — a small leak, but we hold the Proton bar. Each accepted record gets
  its own rev, so pull ordering is total.
- **The batch transaction discipline** `[P]`: the `SELECT … FOR UPDATE` on the
  `sync_accounts` row is acquired **unconditionally at batch start, before any
  record is examined** — never lazily on first rev assignment. This
  serialises concurrent batches for the account, so an application-level CAS
  check can never race a concurrent insert into a composite-PK violation that
  would abort the whole batch (per-record atomicity, §7.1, depends on this).
  With the lock held to commit, revs become visible in assignment order, so a
  paged pull can never permanently skip a rev.
- **`instance_epoch`** `[P]`: a random identity for this store's lifetime,
  returned on **every** push/pull response and in every doorbell poke. A
  database restore from backup produces a fresh epoch; clients detect the
  change and run the recovery procedure (§12.2) instead of silently diverging.
  (A `bad_since` check alone cannot detect most restores: once post-restore
  pushes re-advance `head` past a client's watermark, that client would pull
  "normally" and skip every re-minted rev forever.)
- **No timestamp columns.** The server *stores* no receipt times. This removes
  the at-rest record; it does **not** remove timing as a live observable —
  see §6.1 for the honest statement `[L]`.
- **Write semantics, mechanically enforceable without content knowledge:**
  1. **Insert** (`baseRev = 0`): create if absent, assign a fresh rev. If a
     record already exists under that `blind_id` → `conflict` with the current
     record (two devices minted the same entity — only possible via replay of
     the same uuid, and the client resolves idempotently).
  2. **Update** (`baseRev = n`): compare-and-swap. Current rev ≠ `baseRev` →
     `conflict` with the current record; the client resolves (per-collection
     rules, §12.3) and re-pushes. An update whose `collection` differs from
     the stored record's tag → per-record `collection_mismatch` error `[P]`.
  3. **Delete**: **unconditional — deletes skip CAS.** Delete-always-wins
     (deep-dive decision A) means a stale `baseRev` must not stop a tombstone.
     Sets `deleted = true`, nulls `nonce`/`ciphertext`/`ciphertext_hash`,
     assigns a fresh rev. Deleting an absent record **creates** the tombstone
     (the create may not have synced yet — terminality must still hold).
     Deleting a tombstone is idempotent: returns the existing rev, no head
     bump, no doorbell. Deletes are additionally subject to the per-account
     delete-rate ceiling (§7.4) `[L]`.
  4. **Tombstone terminality:** any insert or update against a tombstoned
     `blind_id` → per-record `tombstoned` outcome carrying the tombstone; the
     client discards its local copy into the trash (§12.3). A re-created
     entity has a new uuid and therefore a new `blind_id` — never suppressed
     (ADR 0025).
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

- `key` is the row's **primary key serialised as a string** `[P]`: a uuidv7
  for most collections, the literal `"1"` for the `settings` singleton, and
  the composite `"<documentId>#<chunkIndex>"` for `vectors` (the embedding
  store's native key shape).
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
plaintext  = u32-LE length prefix || encode(row) || zero padding (§5.3)
nonce      = 12 random bytes (fresh per seal, never reused)
aad        = utf8('chatsundere-sync-v1') || utf8(collection) || blind_id
ciphertext = AES-256-GCM(key, nonce, plaintext, aad)
```

**`encode(row)` is a binary-aware codec, not bare `JSON.stringify`** `[P]`.
Bare JSON silently corrupts real rows: a `Uint8Array` becomes an index-keyed
object and a `Blob` becomes `{}` — and `providers.apiKey` /
`mcpServers.auth.key` are `EncryptedBlob { ciphertext: Uint8Array, nonce:
Uint8Array }`, while `vectors` rows carry `codes`/`scales`/`offsets`
`Uint8Array`s. The codec is JSON with one reserved wrapper: every
`Uint8Array` value is encoded as `{ "$bytes": "<base64url>" }` and decoded
back on open. The key `"$bytes"` is reserved — no schema field uses it,
asserted by test. `Blob` values are **unrepresentable by design**: the
`Blob`-bearing collections are excluded from v1 (§5.4) and join with the blob
transport, which brings its own binary path.

The AAD does three jobs: a blob cannot be replayed under a **different
blind_id** (anti-swap — the same discipline as `sealSecret`'s slot binding),
it cannot be moved to a **different collection**, and a future envelope v2
cannot be confused with v1. The wire/DB additionally carries the cleartext
`envelope_version` discriminator (§4) so a future v2 never needs
trial-decryption across versions `[L]`. `openRecord` additionally recomputes
the blind index from the decrypted row's key and requires it to match the
`blind_id` the record was fetched under — belt and braces on top of GCM.

Exports (names indicative): `computeBlindId(mk, collection, key)`,
`sealRecord(mk, collection, row)` →
`{ blindId, envelopeVersion, nonce, ciphertext, ciphertextHash }`, and
`openRecord(mk, collection, blindId, { nonce, ciphertext })` → row. All
parent/child pointers (`chatId` on a message, `personaId` on a chat) live
inside the ciphertext; the server never reconstructs the graph.

**Nonce bound, documented** `[L]`: one DEK per collection with random 96-bit
nonces is subject to the NIST SP 800-38D ~2³² invocation bound per key.
Unreachable for a companion app's realistic edit volume, but it is a real
bound and is recorded here as the rotation trigger discussion point tied to
the existing "MK never rotates pre-beta" posture (§19).

### 5.3 Padding — where the sidechannel is real

`personas`, `memoryBody`, `memoryJournal`, and `seedTemplates` `[L]`
plaintexts are padded to the next **power-of-two bucket starting at 1 KiB**
(1 → 2 → 4 → … → 1024 KiB). **Buckets cap at 1 MiB** `[P]`; a plaintext above
1 MiB is padded up to the next 256 KiB boundary instead, so padding can never
manufacture a record that violates `MAX_RECORD_BYTES` (§7.4). Rationale
(deep-dive decision, reaffirmed 2026-07-01): blob size on these collections
reads as "elaborate custom instructions and a lot of memory" — an
intensity-of-use inference worth blunting. `seedTemplates` joins the set from
the review round: saved primer conversations are conversation-shaped,
`nsfw`-flagged content — exactly the same sensitivity class `[L]`. The u32
length prefix makes unpadding trivial and deterministic. **No other collection
is padded in v1**, by decision, not omission.

### 5.4 The collection allowlist

Re-baselined against the live schema — **Dexie v32, 18 tables** `[L]`/`[P]`
(the analysis' "17 at v30" was stale). The server validates `collection`
against this fixed set (bounding both storage abuse and any future
metric-label cardinality):

```
settings, providers, mcpServers, mindspaces, personas, chats, messages,
pills, seedTemplates, libraries, documents, vectors,
memoryJournal, memoryBody, compactionCheckpoints
```

**Excluded, each with a reason:**

- `personaAvatars`, `artefacts`, `attachments` — `Blob`-bearing; they join
  the allowlist with the **blob transport** follow-up spec (Chris's call,
  2026-07-01). Until then image artefacts and attachments do not follow the
  user to a new device; chats referencing them render placeholders. An honest
  v1 boundary, stated in user-facing copy when the client engine ships `[P]`.
- `voiceAudio` — transient LRU, rebuildable, never syncs.
- **Built-in mindspaces** (`builtIn: true`) — their uuids are minted fresh
  per device (`seedBuiltinsIfNeeded`), so syncing them would duplicate all
  seven on every device. Only user-created mindspaces sync; the
  `settings.defaultMindspaceId` dangling-pointer consequence is handled
  client-side (§12.5) `[P]`.

`vectors` **stays in v1** (Chris's call, 2026-07-01 — re-embedding costs the
user time and battery; the existing stamp mechanism is kept): rows ride the
binary codec (§5.2), their non-uuid key rides §5.1, and their conflict rule is
stamp-based adoption (§12.3). Their `tags` carry document/library ids →
inside ciphertext, as everything else.

Device-local settings fields are stripped client-side before sealing (§12.5).

### 5.5 `ciphertext_hash`

SHA-256 over the ciphertext, computed client-side, verified server-side on
write (mismatch → per-record `hash_mismatch` error). Cheap, leaks nothing new
(the server holds the ciphertext anyway), and gives the ADR 0026 handover its
"did I receive everything?" completeness check later.

## 6. Threat-model position — honest boundaries

Stated so the boundary of the promise is auditable, not implied.

### 6.1 What the server learns (confidentiality residue)

With this design the server (and anyone with its database) still learns:

- that an account exists, **how many** records of which **collection** it
  has, and their **sizes** (except the padded four),
- the **server-receipt order** (`rev`) — and, because `blind_id` is
  deterministic, the **per-entity mutation count and cadence** (this persona
  was edited nine times; this settings row changes daily) `[L]`,
- live **write timing**: no timestamp is stored, but the write path and the
  doorbell publish happen in real time — an operator observing the process
  learns the rhythm of a user's activity. Absence of a column is not absence
  of the observable; we do not pretend otherwise `[L]`,
- **which** records were deleted (as opaque tokens) and when in rev-order.

**Chris's explicit call (2026-07-01): this residue is immaterial under our
threat model.** The attacks that matter (operator or DB-thief reading
conversations, custom instructions, identities, NSFW status; correlating
content timestamps at rest) are all closed by the envelope; the
intensity-of-use inference is closed by §5.3 padding exactly where it bites.
Consciously **not** built in v1: blinding the collection tag, padding
everything, cover traffic. The **NSFW/adult flag is a hard invariant**: it
lives inside ciphertext only (`personas.adultPersona`, `libraries.nsfw`,
`seedTemplates.nsfw`) and must never become a server-visible column or wire
field — invariant-tested (§17) so no future "index by nsfw" shortcut can
creep in.

### 6.2 What a malicious server can do (integrity/availability boundary) `[L]`

The envelope protects **confidentiality**. It does **not** protect against a
malicious or compromised server:

- **Withholding / omission:** a pull can silently omit records; a fresh
  device (`since=0`) never learns they existed. `ciphertext_hash` +
  contiguous pulls prove integrity of what was *delivered*, not completeness
  against what *should* exist — `head` is server-asserted.
- **Rollback:** a stale-but-valid ciphertext can be served for a `blind_id`;
  it decrypts cleanly. Content-`updatedAt` LWW protects devices that already
  hold a newer copy; a fresh device has no anchor. Nothing in the AAD binds
  `rev` (deliberately — the server assigns it after sealing).
- **Destruction:** tombstones carry no cryptographic material, so a malicious
  server can synthesise them (§4.3). The client-side trash (§12.3) bounds the
  blast radius on devices that already hold the data; a fresh device simply
  never sees the destroyed records.

**None of these are defended in v1, and we say so.** Defences (a signed head,
a client-anchored manifest/Merkle root) are heavyweight and deferred as a
conscious post-beta consideration (§19). The `instance_epoch` (§4) defends
against *accidental* divergence (restores), not malice. The honest summary
for user-facing copy: *the server can never read your data; a hostile server
could lose or destroy it — which is why devices keep full local copies and
why self-hosting is first-class.*

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
    { "blindId": "…", "collection": "chats", "envelopeVersion": 1,
      "baseRev": 17, "deleted": false, "nonce": "…", "ciphertext": "…",
      "ciphertextHash": "…" },
    …
] }

200 { "head": 4710, "epoch": "<instance_epoch>",
      "results": [
        { "status": "ok", "rev": 4710 },
        { "status": "conflict", "current": { …full record… } },
        { "status": "tombstoned", "current": { …tombstone… } },
        { "status": "error", "code": "record_too_large" },
        …
] }
```

- **Per-record atomic, never all-or-nothing.** Conflicts are normal
  operation; a `conflict` on record 3 must not roll back records 1–2. One
  database transaction (account lock taken at batch start, §4) processes the
  batch in order and collects per-record outcomes; `results[i]` corresponds
  to `records[i]`.
- Request **shape** violations (malformed JSON, unknown fields, over
  `MAX_PUSH_RECORDS`, wrong decoded lengths — `blindId` ≠ 16 B, `nonce` ≠
  12 B, `ciphertextHash` ≠ 32 B `[P]`) → whole-request `400`. **Semantic**
  outcomes (conflict, tombstoned, too large, quota, hash mismatch, unknown
  collection, collection mismatch, delete rate) → per-record `results`
  entries.
- `conflict`/`tombstoned` return the **full current record** so the client
  can resolve without an extra round trip.
- Tombstone pushes (`deleted: true`) omit `nonce`/`ciphertext`/
  `ciphertextHash` and ignore `baseRev` (§4 — deletes skip CAS).

### 7.2 Pull

```
GET /api/v1/sync/changes?since=<rev>&limit=<n>
Authorization: Bearer <account access JWT>

200 { "head": 4711, "epoch": "<instance_epoch>", "more": false,
      "records": [
        { "blindId": "…", "collection": "…", "envelopeVersion": 1,
          "rev": 4708, "deleted": false, "nonce": "…", "ciphertext": "…",
          "ciphertextHash": "…" },
        { "blindId": "…", "collection": "…", "rev": 4709,
          "deleted": true },                     ← tombstone shape [P]
        … ] }
```

Records with `rev > since`, ascending, up to `limit` (default 200, max 500 —
an over-max `limit` is **clamped**, not refused) and up to a **page byte
budget** (`PULL_BYTE_BUDGET`, default 8 MiB of encoded records — the page
ends early with `more: true` when the next record would exceed it) `[P]`.
Tombstones carry no `nonce`/`ciphertext`/`ciphertextHash` — the wire types
mark them optional `[P]`. `since=0` is the full-state pull — new-device
onboarding and the ADR 0026 handover sync-down are this same call, paged and
progress-barred by the client.

### 7.3 The piggyback, reduced to one data path

The push response carries `head`. The client's rule, pinned `[P]`:
**pull iff `head` > max(own watermark, highest `rev` in this push's
`results`)**. (The max-of-results form matters: an idempotent tombstone
result returns an *old* rev with no head bump, and a client already behind
must not mis-conclude from arithmetic on "just-assigned" revs.) The analysis'
original idea (push response returns the caller's unseen changes) is
deliberately reduced to this: returning data on push would create a second
delivery path duplicating pull's semantics. One path, one set of tests.

### 7.4 Quotas and ceilings

- `MAX_RECORD_BYTES` (default **2 MiB** of ciphertext `[P]` — headroom above
  the 1 MiB padding cap, §5.3, and room for large knowledge documents) —
  over → per-record `record_too_large`.
- `ACCOUNT_QUOTA_BYTES` (default 1 GiB) — a push that would exceed it →
  per-record `quota_exceeded`; the error payload includes `usedBytes` and
  `quotaBytes` so the client can tell the user constructively.
- `MAX_PUSH_RECORDS` (default 100) and `MAX_BODY_BYTES` (default 24 MiB) —
  request-shape ceilings → `400`/`413`. **The client batches by summed
  encoded size, never by count** `[P]` (§12.4): 100 × 2 MiB × 4/3 base64
  would otherwise exceed any sane body cap — the count ceiling is a backstop,
  not the batching rule.
- **Delete-rate ceiling** `[L]`: tombstone writes count against a separate
  per-user sliding window (`RATE_LIMIT_DELETE_PER_MIN`, default 60). Over →
  per-record `delete_rate_limited` (retriable). Legitimate bulk deletion
  (clearing a chat) retries over a few minutes; a stolen token cannot
  tombstone an entire account in one burst.
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
**Accepted residual** `[L]`: the ticket still traverses a URL query and may
land in front-proxy access logs — bounded by single-use + 30 s TTL + the fact
that it is not an identity credential (it maps to an account only inside
Redis, briefly). First-frame auth was considered and rejected as more
stateful for negligible gain; recorded here so the trade-off is conscious.

### 8.2 Server behaviour

On every accepted push batch the write path `PUBLISH`es the new `head` to the
Redis channel `sync:<account_id>` — **once per batch, not per record, and
strictly after the database transaction commits** `[L]`/`[P]` (a pre-commit
poke would race the subscriber's pull against an invisible transaction and
defeat the doorbell exactly on the latency path it exists for). The doorbell
hub holds one multiplexed Redis subscriber connection,
`SUBSCRIBE`/`UNSUBSCRIBE`-ing per-account channels as sockets come and go,
and forwards to each of the account's sockets:

```
{ "rev": 4711, "epoch": "<instance_epoch>" }
```

Never anything else — no collection, no blind_id, no count. The client's sole
reaction is "pull now" (or the epoch procedure, §12.2). A mis-routed or
spoofed poke can cause at most one redundant pull; it leaks nothing and costs
nothing.

### 8.3 The pusher hears its own bell

The pushing device receives its own poke; its pull is watermark-guarded and
cheap (§12.2). Not worth suppressing.

### 8.4 Lifetime and liveness — precise claims `[P]`

The server closes the socket when the token the ticket was minted from
expires (≤ 15 min, `ACCESS_TTL`); the client obtains a fresh ticket and
reconnects with jittered backoff. This gives the doorbell **the same
revocation boundary** as every other surface (a logged-out device loses its
bell within one token TTL — and immediately where the deny-list catches the
ticket mint, §9).

Liveness within the window is **not** free: a contentless socket receiving no
pokes is indistinguishable from a half-open one, and Bun's WebSocket
`idleTimeout` **defaults to 120 s** — our own server would kill every quiet
doorbell long before token expiry. Therefore, pinned: `idleTimeout` is set
explicitly to outlive the token window (§14), and the hub sends a
**protocol-level ping every `WS_PING_INTERVAL_S` (default 30 s)**, which both
defeats idle timeouts (Bun's, Traefik's, NAT) and detects a dead peer within
~one interval. The 15-minute forced reconnect then *bounds* the staleness of
anything ping cannot see. Per-account concurrent-socket cap (default 8,
in-process — single-replica scope, noted as such).

## 9. Authentication — inherited from the proxy, plus revocation in v1

Identical to proxy spec §4 for verification: resource-server JWKS with
`algorithms: ['EdDSA']` pinned, `iss` exactly **`chatsundere-auth-v1`** (the
skeleton's `chatsundere-auth` default is wrong — same bug the proxy
corrected; fix `env.ts` and `.env.example`), `exp` with 5 s tolerance, `aud`
declared but ignored (variant a), hardened `jose` fetch options, JWKS failure
→ `401` fail closed. The `aud`-ignore forward-guard applies verbatim:
revisit the moment the auth-service mints a second EdDSA token type under the
same issuer.

**Deviation from the proxy — revocation is v1 here (Chris's call,
2026-07-01)** `[L]`. On the stateless proxy a stolen 15-minute token burns
egress; on this stateful store the same window can **irreversibly destroy the
vault** (tombstones, §4.3). The window is closed with a transient Redis
deny-list:

- **auth-service writes** (small addition to the already-audited flows): on
  **logout** and **session revocation** → `revoked:jti:<jti>`; on
  **suspension** and **account deletion** → `revoked:sub:<sub>`. Every entry
  carries **TTL = `ACCESS_TTL`** — after 15 minutes all affected tokens have
  expired anyway (suspended users cannot refresh; the middleware already
  refuses them), so the deny-list is self-cleaning and never grows.
- **sync-service checks** after signature verification: `EXISTS` on both keys
  → `401`. Redis outage → `503` fail closed (already the house rule). The
  doorbell inherits the check at ticket mint.
- **Deployment requirement:** auth-service and sync-service must share the
  Redis instance/database for the deny-list keys to be visible (§14).
- The proxy adopts the same check with the device-management workstream —
  its risk profile tolerates the window; sync's does not.

**Still deferred, still owned:** no Postgres account-existence check per
request — a token minted before an account's deletion is caught by the
deny-list, so the residual is only exotic clock-skew cases, accepted.

## 10. Hardening & observability

### 10.1 Rate limits, client IP, CORS

- Client IP from the trusted-proxy hop (`TRUST_PROXY_HOPS`/
  `TRUSTED_PROXY_CIDR`), never a client-settable header; per-IP limit
  pre-auth, per-user post-auth; Redis sliding window, **fail closed**;
  `429` + `Retry-After`. All proxy-inherited.
- Defaults: per-user 120/min, per-IP 600/min (env-tunable), plus the
  delete-rate window (§7.4). The doorbell ticket endpoint shares the per-user
  limit; upgrade attempts count against per-IP.
- **CORS here is conventional** (unlike the proxy, whose permissiveness is
  its purpose): exact-origin match against `CORS_ALLOWED_ORIGINS` (default
  `https://app.chatsundere.me`; dev adds localhost), reflected specific
  origin, `Vary: Origin`, no credentials (auth is a header, not a cookie).

### 10.2 Logging and metrics — anonymous, ciphertext-blind

- **No `account_id`, `sub`, `jti`, or `blind_id` in any log line or metric
  label, ever** — invariant-tested. Generic request logs (status, duration,
  route) are fine; the sensitive dimension is identity, and the payload is
  ciphertext by construction.
- Metrics (ops port): `sync_push_records_total{outcome}` (`ok, conflict,
  tombstoned, record_too_large, quota_exceeded, hash_mismatch,
  bad_collection, collection_mismatch, delete_rate_limited`),
  `sync_pull_total`, `sync_pull_records_total`, `sync_doorbell_connections`
  (gauge), `sync_doorbell_pokes_total`, `sync_unauthorized_total`,
  `sync_revoked_total`, `sync_rate_limited_total`, push/pull latency
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
absolute `https` URL, same as `PROXY_PUBLIC_URL`. Unset → no `syncUrl` key
and no `"sync"` feature (an operator may run auth+proxy without sync); the
client drives "disabled over hidden" from `features`. **Mirror requirement on
the sibling spec** `[P]`: `PROXY_PUBLIC_URL` must equally be optional
(auth+sync without proxy is a legitimate topology); noted here for the proxy
plan since its spec does not state it.

## 12. The client engine — the contract this server is built against

**Not built in the overnight run** (§16), but pinned here so the server
contract is verifiably sufficient. The later client session implements this
against the already-built, already-audited server. The engine's Dexie bump is
**v33** (v31 = screen effects, v32 = seed templates — the analysis' "v31" was
stale `[P]`), and the known ~24 hard-coded `db.verno` test assertions sweep
must be planned with it.

### 12.1 The two write classes — refined against the real schema `[P]`

- **Class 1 — offline-capable:** (a) **appends** to the append tables:
  `messages` (once `streamingState: complete`), `memoryJournal` entries,
  `compactionCheckpoints`; (b) **creation-inserts of freshly-minted uuids**
  in any synced collection (a new chat, persona, document, library, seed
  template created offline is a fresh uuid — conflict-free by construction,
  `baseRev: 0`). Enqueued to `syncOutbox` in the **same Dexie transaction**
  as the local write. **Exception:** `memoryBody` creation stays Class 2 —
  it is coupled to the Class-2 journal state transitions of the dream that
  produces it.
- **Class 2 — mutating, online-required:** every edit/delete of an existing
  record. Write-through: the local write settles only when the server acks
  the rev (the two-phase discipline already proven by the memory-body
  editor). Offline → disabled-with-reason, never hidden.

**The `chats` field-disposition table** `[P]` — the naive "a chat row edit is
Class 2" does not survive the real `ChatRow`, whose fields mutate as side
effects of Class-1 appends and background jobs. Disposition:

| Field | Disposition |
|---|---|
| `id`, `personaId`, `createdAt` | immutable, set at creation (Class 1) |
| `title` | synced, Class 2. Title-gen with the backend unreachable **defers** (title stays default until connectivity returns) |
| `lastMessageAt`, `bookmarkedMessageCount` | **derived** from messages locally — never synced, recomputed on apply |
| `activeCompactionId` | **derived** — latest checkpoint per chat (verified against `compaction/repo.ts`: no path sets a non-latest pointer); checkpoint creation stays pure Class-1 append, so overflow-failsafe compaction works with the backend unreachable |
| `draftInput` | **device-local** (Chris 2026-07-01, revising the analysis inventory — a draft is a per-keystroke mutation; Class-2 gating would forbid typing offline, which is absurd; consistent with the already-device-local lazy-chat drafts) |
| `openerPending`, `compactionToastShown` | **device-local** transient UX state |
| `lastExtractedMessageId` | synced, Class 2 by background job — extraction already defers to connectivity (analysis §2.4); concurrent extractors converge via CAS (the loser re-pulls the advanced cursor and skips) |

Related dispositions: **`pills`** are pushed once their message completes
(append-once-terminal — the tool-loop `status`/`payload` churn never goes on
the wire) `[P]`. **`messages.bookmarked`/`bookmarkLabel` are Class-2 edits on
an otherwise immutable row** `[P]` — bookmarking offline is
disabled-with-reason (a UX consequence for Laura's spec-pass of the engine
session, named here so it is a decision, not a discovery). **`vectors`**
writes ride their document's lifecycle: creation-inserts with a new document
(Class 1), re-embeds with a document edit (already Class 2) or a model/codec
change (background job, defers to connectivity); a document delete enqueues
tombstones for its vector rows, including shrunk chunk tails.

### 12.2 Watermark and epoch rules (the correctness-critical detail)

The client's high-water `rev` advances **only via pull**, page by page, to
the last record's rev of each page, looping while `more`. It must **never**
advance from push results: own revs may interleave with another device's
(push returns revs 10 and 12 while device B took 11 — jumping to 12 would
skip 11 forever). Pulls therefore re-deliver the client's own recent writes;
application is idempotent (upsert by the uuid inside the blob — a no-op when
the content matches). Echo-tolerance is a **required** engine property,
tested as such.

**Epoch rule** `[P]`: the client persists the `epoch` it first syncs against.
Any response or poke carrying a **different** epoch (server restored from
backup, or a self-hoster reset their store) aborts the current cycle and runs
the **recovery procedure**: treat every local row as dirty — pull-all from
`since=0`, merge by uuid under the §12.3 rules, then re-push the entire local
state with fresh `baseRev`s (outbox entries from the old epoch have their
`baseRev`s invalidated to re-derive). No silent divergence: local data always
wins its way back up.

### 12.3 Conflict resolution (all client-side, deep-dive decisions A/C/E)

- **Delete always wins**, globally — but a **pulled** tombstone routes the
  local row to a **recoverable client-side trash** with a grace window
  (default 30 days) instead of a hard discard `[L]`: it bounds the blast
  radius of a malicious/buggy mass-tombstone on devices that already hold
  the data. The user's **own local delete remains immediate** (shame-delete
  dignity is untouched). Restoring from trash mints a **new uuid**
  (terminality respected — the old `blind_id` stays dead). Outbox entries
  for a tombstoned uuid are dropped.
- **Undecryptable or malformed pulled records are rejected inertly** `[L]`:
  a record that fails GCM, the codec, or the blind-id re-check **never
  mutates or deletes local state** and never advances that uuid's
  application; it surfaces a diagnostic only. (A token-thief can overwrite
  server-side ciphertext with garbage — the server cannot tell; honest
  clients must not compound the damage locally.)
- **Edit vs edit:** LWW, tie-break by uuid, on a per-collection resolution
  key `[P]` — "the decrypted `updatedAt`" alone was unimplementable (half
  the allowlist has no such field):

  | Collections | Resolution key |
  |---|---|
  | `personas`, `libraries`, `documents`, `providers`, `mcpServers`, `settings`* | existing `updatedAt` |
  | `chats`, `messages`, `mindspaces` | engine-stamped `updatedAt`, added on Class-2 edit by the v33 engine migration |
  | `memoryJournal` | **state precedence**, not LWW: `archived` > `committed` > `uncommitted` (transitions are monotone; the furthest state wins) |
  | `vectors` | **stamp-based adoption**, not LWW: compatible `codecVersion`/`modelId`/`dim` stamp → adopt the pulled row; incompatible → keep local and re-embed locally (the transfer feature's `resolveVectorStrategy` mechanism, kept per Chris) |
  | `pills`, `compactionCheckpoints`, `seedTemplates`† | immutable / creation-only in practice; conflicts resolve as idempotent no-ops |

  \* `settings` is server-wins whole-row regardless (below). † seed-template
  *edits* are Class-2 with engine-stamped `updatedAt` if editing ships.
- **`memoryBody`:** never merged — on divergence, discard the losing body
  and re-dream from the unioned journal (ADR 0031). **Anti-ping-pong rule**
  `[P]`: a device whose freshly-dreamt body loses a CAS race **adopts** the
  winner instead of re-dreaming when the winner's `entriesProcessed` covers
  its own journal view; it only re-dreams if it holds journal entries the
  winner has not processed.
- **`settings`:** server wins, whole row, no field-level merge; a one-line
  honest note tells the user the account's settings apply.

### 12.4 Sync triggers and batching

Timer + pull-on-foreground + push-piggyback `head` check (§7.3) + doorbell
poke. A single-flight worker (Web Locks, like the memory pipeline's guard)
runs whenever the session is unlocked and the backend reachable: drain
outbox, then pull-and-apply. **Push batching is by summed encoded bytes**
(comfortably under `MAX_BODY_BYTES`), never by record count `[P]`.

### 12.5 Device-local strip and built-in mindspaces

Before sealing, the engine strips `settings.adultMode` and
`settings.corsProxy` (device-local by prior decision); on open, missing
fields keep their local values. `chats.draftInput`, `openerPending`, and
`compactionToastShown` are likewise never sealed (§12.1). `voiceAudio` and
the lazy-chat localStorage drafts never enter the engine.

**Built-in mindspaces do not sync** (§5.4) `[P]`. When a pulled
`settings.defaultMindspaceId` (or a persona's mindspace binding) references
a uuid unknown locally — the other device's built-in — the client falls back
calmly to its local default built-in; user-created mindspaces sync normally
and resolve by uuid.

### 12.6 Out of the engine's v1 scope

Uplevelling (in-place merge, dual-MK re-seal window), the ADR 0026 handover
state machine, device management — all consume this same protocol later;
nothing in §4–§8 needs to change for them (the handover's completeness check
is `ciphertext_hash` + contiguous-page pulls, with the §6.2 caveat that
completeness is asserted against the server's own head).

## 13. Error handling

Whole-request errors are generic; per-record outcomes are constructive
(the *dere* way — every failure names the next step for the client to act
on).

| Condition | Response |
|---|---|
| Per-IP limit (pre-auth) / per-user limit | `429` + `Retry-After` |
| Missing/invalid/expired token; JWKS failure | `401`, generic |
| Token/account on the revocation deny-list (§9) | `401`, generic |
| Redis outage | `503`, fail closed |
| Malformed body, unknown field, > `MAX_PUSH_RECORDS`, wrong decoded field length | `400` |
| Body > `MAX_BODY_BYTES` | `413` |
| Unknown `collection` | per-record `error`, `bad_collection` |
| Update `collection` ≠ stored tag | per-record `error`, `collection_mismatch` |
| Ciphertext > `MAX_RECORD_BYTES` | per-record `error`, `record_too_large` |
| Account over quota | per-record `error`, `quota_exceeded` + `usedBytes`/`quotaBytes` |
| Delete-rate window exceeded | per-record `error`, `delete_rate_limited` (retriable) |
| `ciphertext_hash` mismatch | per-record `error`, `hash_mismatch` |
| CAS miss | per-record `conflict` + current record |
| Write to tombstoned `blind_id` | per-record `tombstoned` + tombstone |
| Doorbell ticket invalid/expired/reused | upgrade refused (`401` / close `4401`) |
| Pull `limit` > max | clamped, not an error |
| Pull `since` malformed/negative | `400` |
| Pull `since` > `head` | `400`, `bad_since` — combined with the epoch rule (§12.2) this signals a reset the epoch already catches; the client runs the same recovery |

## 14. Configuration (env)

| Var | Service | Meaning |
|---|---|---|
| `DATABASE_URL` | sync | Postgres (own database, e.g. `sync_db`) |
| `REDIS_URL` | sync | rate limits, deny-list reads, doorbell pub/sub, tickets. **Must point at the same Redis instance/db as the auth-service** for deny-list visibility (§9) |
| `AUTH_JWKS_URL` | sync | JWKS endpoint |
| `JWT_ISSUER` | sync | **default corrected to `chatsundere-auth-v1`** |
| `JWT_AUDIENCE` | sync | declared, explicitly ignored (variant a) |
| `CORS_ALLOWED_ORIGINS` | sync | exact origins, default `https://app.chatsundere.me` |
| `TRUST_PROXY_HOPS` / `TRUSTED_PROXY_CIDR` | sync | trusted front boundary |
| `RATE_LIMIT_USER_PER_MIN` / `RATE_LIMIT_IP_PER_MIN` | sync | defaults 120 / 600 |
| `RATE_LIMIT_DELETE_PER_MIN` | sync | default `60` (tombstones per user, §7.4) `[L]` |
| `MAX_RECORD_BYTES` | sync | default `2097152` (2 MiB ciphertext) `[P]` |
| `ACCOUNT_QUOTA_BYTES` | sync | default `1073741824` (1 GiB) |
| `MAX_PUSH_RECORDS` | sync | default `100` (backstop; clients batch by bytes) |
| `MAX_BODY_BYTES` | sync | default `25165824` (24 MiB) |
| `PULL_LIMIT_DEFAULT` / `PULL_LIMIT_MAX` | sync | defaults 200 / 500 |
| `PULL_BYTE_BUDGET` | sync | default `8388608` (8 MiB per page) `[P]` |
| `DOORBELL_TICKET_TTL_S` | sync | default `30` |
| `WS_PING_INTERVAL_S` | sync | default `30` (liveness + idle-timeout defeat, §8.4) `[P]` |
| `WS_IDLE_TIMEOUT_S` | sync | explicit Bun `idleTimeout`, default `960` (must outlive the token window; Bun's default 120 s would kill quiet doorbells) `[P]` |
| `MAX_SOCKETS_PER_ACCOUNT` | sync | default `8` (in-process, single-replica) |
| `PORT` / `OPS_PORT` | sync | public API / internal ops |
| `SYNC_PUBLIC_URL` | auth-service | value for `GET /api/v1/config`; absolute `https`, optional |

`.env.example` updated for both services; the test database follows the
auth-service `TEST_DATABASE_URL` isolation pattern.

## 15. Wire reference (concrete shapes for `curl`/`wscat` verification)

Blobs are produced with the overnight run's `tools/seal-cli.ts` (mint an MK,
seal a sample row, print the base64url fields) — hand-crafting AES-GCM blobs
is not a thing `[P]`.

```
# Push (device 1)
curl -X POST https://sync.chatsundere.me/api/v1/sync/changes \
  -H 'Authorization: Bearer <JWT>' -H 'Content-Type: application/json' \
  -d '{"records":[{"blindId":"<b64url>","collection":"personas",
       "envelopeVersion":1,"baseRev":0,"deleted":false,
       "nonce":"<b64url>","ciphertext":"<b64url>",
       "ciphertextHash":"<b64url>"}]}'
# → {"head":1,"epoch":"…","results":[{"status":"ok","rev":1}]}

# Pull (device 2, same account)
curl 'https://sync.chatsundere.me/api/v1/sync/changes?since=0&limit=200' \
  -H 'Authorization: Bearer <JWT2>'
# → {"head":1,"epoch":"…","more":false,"records":[{…the same blob…}]}

# Doorbell
curl -X POST https://sync.chatsundere.me/api/v1/sync/doorbell-ticket \
  -H 'Authorization: Bearer <JWT2>'          # → {"ticket":"…"}
wscat -c 'wss://sync.chatsundere.me/api/v1/sync/doorbell?ticket=…'
# push again from device 1 → the socket receives {"rev":2,"epoch":"…"}
```

## 16. Scope boundary — the seam

**IN (this spec, overnight remote execution, headless):**
- Full `sync-service`: schema + migrations (incl. `instance_epoch`), push/pull
  with CAS + tombstone terminality + quotas + delete-rate ceiling, doorbell
  (ticket + WSS + Redis pub/sub + ping), JWKS auth + deny-list check, rate
  limits, CORS, ops split, anonymous metrics.
- `packages/crypto` `sync-envelope.ts` (blind index, binary codec, seal/open,
  padding, hash) — pure, TDD-ideal.
- `packages/shared-types` sync wire types + error codes.
- `apps/auth-service`: deny-list writes on logout / session revocation /
  suspension / account deletion (§9) `[L]`, and the `/api/v1/config`
  extension (`syncUrl`, `"sync"` feature).
- `tools/seal-cli.ts` (§15) `[P]`.
- Fully Bun-testable + `curl`/`wscat`-able (§15, §18). **Larissa re-audits
  the built diff before squash.**

**OUT (later sessions):**
- The client sync engine (§12) — Dexie **v33** `syncOutbox`/`syncState`/trash,
  worker, per-write-path outbox enqueue, connectivity gating, the engine
  migrations (`updatedAt` stamps). Invasive across the user-client's write
  paths; built inline (Liz) with Laura gating the UX (incl. the named UX
  consequences: offline bookmarking disabled, artefacts/attachments not yet
  following, the settings server-wins note).
- Uplevelling (in-place merge, dual-MK re-seal), the ADR 0026 handover
  machine, the device/session-management surface.
- Blob transport (S3): own follow-up spec; `personaAvatars`, `artefacts`,
  `attachments` join the allowlist there (Chris 2026-07-01).
- Account-deletion **purge** of `sync_db` (orphaned-ciphertext retention) —
  an explicit cross-service obligation deferred to the account-lifecycle
  workstream, named here so it is not a silent omission `[L]`.

## 17. Testing (Bun runner; crypto in the packages/crypto vitest suite)

- **Envelope:** seal/open round-trip per collection **including binary
  fields** (a `providers` row with a real `EncryptedBlob`, a `vectors` row
  with `codes`/`scales`/`offsets`) `[P]`; the `$bytes` reserved-key assertion;
  padding bucket edges (1023/1024/1025 B; the 1 MiB cap crossover into
  256 KiB steps) `[P]`; nonce uniqueness across seals; AAD tamper matrix —
  foreign `blind_id`, foreign collection, v2 version tag each → decrypt
  failure; `openRecord` rejects a blob whose inner key does not re-HMAC to
  the fetched `blind_id`; deterministic `computeBlindId` across devices
  (same MK), divergence across MKs; the vectors composite key shape.
- **NSFW invariant:** full sealed wire payloads for `personas`, `libraries`,
  **and `seedTemplates`** `[L]` contain no `adultPersona`/`nsfw` bytes
  outside ciphertext (whole-wire scan, the transfer feature's discipline).
- **CAS matrix:** insert-on-absent ok; insert-on-present → conflict +
  current; stale/fresh `baseRev` update; update with mismatched collection →
  `collection_mismatch` `[P]`; delete with stale `baseRev` still wins; delete
  of absent record creates a terminal tombstone; delete idempotence (no head
  bump, no poke); insert **and** update against a tombstone → `tombstoned`;
  ciphertext/nonce/hash `NULL` after tombstoning; **two concurrent batches
  inserting the same `blind_id`** → one ok, one clean per-record conflict,
  neither batch aborted (the lock-at-batch-start discipline) `[P]`.
- **Rev/epoch semantics:** per-account monotonic, contiguous within a batch;
  two accounts do not observe each other's revs; pull pagination (`more`,
  ascending, `since` boundaries, the **byte budget ending a page early**
  `[P]`); `since > head` → `bad_since`; `epoch` present on push, pull, and
  poke; a fresh `instance_epoch` after a simulated re-migration `[P]`.
- **Batch:** per-record outcomes positionally aligned; a conflict does not
  roll back neighbours; one doorbell publish per batch, **fired only after
  commit** (test: subscriber that pulls immediately on poke sees the new
  records) `[L]`/`[P]`.
- **Quota/ceilings:** `record_too_large`, `quota_exceeded` (with used/quota
  payload), byte accounting across update (delta) and tombstone (freed);
  `MAX_PUSH_RECORDS`/`MAX_BODY_BYTES` → `400`/`413`; **delete-rate window →
  `delete_rate_limited`, ordinary writes unaffected** `[L]`.
- **Hash:** `ciphertext_hash` mismatch → per-record error, nothing stored.
- **Revocation** `[L]`: after a logout deny-entry, push/pull/ticket-mint →
  `401` within the same second; entry TTL-expires; suspension `sub` entry
  blocks all of an account's tokens.
- **Doorbell:** ticket single-use (second connect refused); expired ticket
  refused; poke carries only `{rev, epoch}`; socket closed at token expiry;
  **ping frames flow at the configured interval** `[P]`; per-account socket
  cap; a poke on account A never reaches account B's socket.
- **Tombstone wire shape:** pulled tombstones omit
  `nonce`/`ciphertext`/`ciphertextHash`; types mark them optional `[P]`.
- **Auth matrix (proxy-inherited):** valid / expired / wrong-issuer /
  tampered / wrong-algorithm / absent → `401`; JWKS failure → `401`; pinned
  `EdDSA` + 5 s tolerance.
- **Validation:** wrong decoded lengths (`blindId`/`nonce`/hash) → `400`;
  over-max pull `limit` clamped; negative `since` → `400` `[P]`.
- **Rate limits:** spoofed `X-Forwarded-For` does not change the key; per-IP
  pre-auth, per-user post-auth; Redis outage → `503` fail closed.
- **Anonymity invariant:** no log line and no metric label contains
  `account_id`/`sub`/`jti`/`blind_id`; no `collection` metric label.
- **Ops split:** `/metrics` only on `OPS_PORT`.
- **Config:** `syncUrl` + `"sync"` present when `SYNC_PUBLIC_URL` set, both
  absent when unset; malformed value fails env-load.
- **seal-cli:** mint/seal/open round-trip through the real server (the §15
  flow as an integration test) `[P]`.

## 18. Manual verification (Chris, on the VPS dry-run)

1. `docker compose up` (auth + proxy + sync + postgres + redis) →
   `docker compose ps` healthy; sync ops endpoints reachable only internally.
2. Register → tokens for "device 1" and "device 2" (same account).
3. `tools/seal-cli.ts`: mint an MK, seal a sample persona row, §15 push from
   device 1 → pull from device 2 → open the pulled blob → the row is intact,
   uuid and timestamps inside.
4. Delete the record from device 2 → push an edit to the same `blindId` from
   device 1 → `tombstoned`, and the DB row shows `ciphertext IS NULL`.
5. `wscat` doorbell on device 2 → push from device 1 → `{"rev":…}` arrives
   within a second; reconnect with the same ticket → refused. **Leave the
   socket silent for 14 minutes through the real Traefik front** → it stays
   alive (pings) and closes at token expiry `[P]`.
6. Logout device 1 → its push and its ticket mint → `401` immediately `[L]`.
7. Push an over-quota / oversized record → constructive per-record error;
   push > 60 tombstones in a minute → `delete_rate_limited` on the tail.
8. `GET /api/v1/config` → `proxyUrl`, `syncUrl`, `features:["proxy","sync"]`.
9. Internal `/metrics` → counters present, **no account/collection labels**.
10. `psql`: `sync_records` shows only ciphertext/blind tokens — no name, no
    uuid, no timestamp column anywhere.

## 19. Open points / deferred

- **Integrity-of-history defences** (signed head, client-anchored
  manifest/Merkle root against §6.2 rollback/omission) — consciously post-beta;
  the honest statement ships now, the machinery later if ever.
- **Account-deletion purge of `sync_db`** — deferred to the account-lifecycle
  workstream; until then a deleted account's ciphertext persists
  (undecryptable — the MK is gone — but a retention obligation, named) `[L]`.
- **Tombstone retention** — tombstone rows live forever in v1 (terminality
  needs them). Revisit compaction only if row counts ever matter.
- **Quota/ceiling defaults** — 1 GiB/account, 2 MiB/record, 60 deletes/min
  are first guesses; tune against real usage. Knowledge documents above
  ~2 MiB plaintext do not sync in v1 (constructive `record_too_large` is the
  UX hook).
- **Nonce bound** `[L]` — ~2³² seals per collection DEK (SP 800-38D);
  unreachable in practice, recorded as the rotation trigger tied to the MK
  posture.
- **Per-collection metric labels** — reintroduce (bounded by §5.4) only when
  the cohort makes per-account correlation moot.
- **Multi-replica** — socket caps and the doorbell registry are in-process;
  a second replica needs sticky sessions or a shared registry.
  Single-replica is the deployment reality for v1.
- **Proxy deny-list adoption** — the proxy inherits the §9 check with the
  device-management workstream.
- **`PROXY_PUBLIC_URL` optionality** — cross-spec note for the proxy plan
  (§11) `[P]`.
- **Blob transport** — own spec; §16.
- **Envelope `v2`** — the cleartext `envelope_version`, the AAD version tag,
  and per-collection DEK contexts (`-v1`) are the built-in migration seams.

## 20. Probes before plan lock-in `[P]`

Empirical checks the implementation plan must run **before** tasks are
locked (the house discipline: probe runtime assumptions, then commit):

1. **Bun.serve + Hono WebSocket composition** — two-port server,
   `server.upgrade` behind a Hono route with the ticket check pre-upgrade;
   confirm `4401` close-code delivery to the browser client.
2. **Bun WS `idleTimeout` semantics** — confirm the configured value
   (960 s) is accepted (Bun documents a max), and whether Bun auto-pings or
   the hub must (assume the hub must).
3. **Traefik WSS idle behaviour on the VPS** — a 14-minute quiet `wscat`
   through the real front with 30 s pings; the poke must still arrive.
4. **Drizzle + postgres-js `bytea`** — `customType` round-trip
   (Uint8Array vs Buffer) at 2 MiB, and `.for('update')` inside
   `db.transaction`.
5. **Per-record loop in one transaction** — latency of 100-record in-order
   processing at realistic sizes (rules out any temptation towards a
   parameter-limited bulk upsert).
6. **Redis subscriber churn** — dynamic SUBSCRIBE/UNSUBSCRIBE per account
   under connect/disconnect load; delivery ordering vs the post-commit
   publish. (GETDEL itself needs no probe — already in production at
   `auth-service/src/routes/step-up.ts`.)
7. **24 MiB JSON body in Hono/Bun** — memory behaviour of `bodyLimit` +
   `req.json()` at the cap.
8. **WebCrypto parity** — HMAC-SHA256 + AES-GCM-with-AAD exact call shapes
   under both the browser and Bun (the envelope runs in the former, is
   tested in the latter).
