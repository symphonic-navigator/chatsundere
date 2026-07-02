# Blob transport (S3/MinIO) + deployment documentation — Block 6C (design)

**Date:** 2026-07-02
**Status:** draft — Chris review pending, then dual adversarial review
(Larissa security lens + Fable protocol/functional lens), as for the sync spec
**Builds on:** `superpowers/specs/2026-07-01-client-sync-design.md` (v2) —
referred to below as "the sync spec". This spec fills the seam the sync spec
deliberately left open (§16/§19 there): the `Blob`-bearing collections
`personaAvatars`, `artefacts`, `attachments` join sync via an S3-compatible
blob store. It also fixes the structure of `obsidian/DEPLOYMENT.md`, the
operator-facing deployment reference (Block 6C's second half).

---

## 1. Why

The record channel ships rows as sealed envelopes through Postgres — capped
at 2 MiB, rev-watermarked, CAS-guarded. Images do not fit that shape: a
generated artefact original is a multi-MiB binary, immutable from the moment
it exists, with no meaningful notion of "edit conflict". Forcing images
through the record channel would bloat Postgres backups, fight the record
cap, and buy none of the CAS machinery's value.

Until this ships, the honest v1 boundary stands: image artefacts and
attachments do not follow the user to a new device; chats referencing them
render placeholders. This spec removes that boundary.

The zero-knowledge bar is unchanged and non-negotiable: blobs are sealed
client-side under an MK-derived DEK before a byte leaves the device. The
server and the object store hold ciphertext only — no plaintext, no MIME
type, no dimensions, no association to a persona or chat.

## 2. Decisions settled with Chris (2026-07-02)

1. **Scope: all of Block 6C** — blob transport spec + plan *and* the
   deployment documentation, one spec, one plan.
2. **Transport shape: proxy through `sync-service`.** The client PUTs/GETs
   against `sync-service`; the service streams to/from the S3 backend over
   the internal network. One public origin; MinIO is never exposed
   (no second Traefik host, no S3 CORS, no presigned-URL machinery); auth,
   rate limits and quota enforcement are exactly the record channel's. Cost:
   bandwidth flows through the Bun process — acceptable at v1's
   single-replica reality and image-sized payloads. Presigned URLs and
   blobs-in-Postgres were considered and rejected (operator complexity /
   wrong tool respectively).
3. **One shared quota.** Records and blobs count against the same
   `ACCOUNT_QUOTA_BYTES`. One mental model, one constructive error, one
   gauge. The default rises from 1 GiB to **2 GiB** (≈ a thousand generated
   images) — a cross-spec amendment to the sync spec's §7.4 default.
4. **Artefact thumbnails sync as blobs of their own.** Every `Blob` field
   maps to one blob object (`blob` and `thumbBlob` separately). This keeps
   the client engine free to fetch thumbnails eagerly (Treasury and chat
   stream picture themselves immediately on a new device) while originals
   stay lazy until opened.

## 3. Architecture overview

```
user-client ──HTTPS──> sync-service ──S3 API (internal network)──> MinIO
                (PUT/GET/DELETE /api/v1/sync/blobs/…)
```

- **No new service.** The blob transport is an extension of `sync-service`:
  same JWT + deny-list auth (sync spec §9), same rate-limit/CORS/ops
  infrastructure (§10 there), same Postgres database for the metadata table,
  shared quota accounting.
- **Generic S3, MinIO as the reference.** The backend is configured as an
  S3-compatible endpoint (`S3_ENDPOINT`, `S3_BUCKET`, credentials,
  `S3_FORCE_PATH_STYLE`). MinIO is the compose default; an operator may point
  the same configuration at Hetzner Object Storage, Garage, or AWS itself.
- **Blobs are immutable.** A blob is written exactly once. Changing an image
  (a new persona avatar, say) mints a fresh `blobId`, uploads the new blob,
  updates the referencing record, then deletes the old blob. Immutability is
  server-enforced (§7.1) and dissolves the whole CAS/rev/conflict apparatus:
  **blobs carry no revs and ring no doorbell** — the referencing *record*
  does, riding the ordinary push/pull channel.
- **Optional by configuration.** With no S3 backend configured,
  `sync-service` runs records-only; blob endpoints answer `blobs_disabled`
  and the `"blobs"` feature flag is absent from `GET /api/v1/config` (§11).

## 4. Server data model

One metadata table joins the sync database:

```
sync_blobs
  account_id       uuid         (from the JWT `sub`; composite PK with blob_id)
  blob_id          text         (client-minted, 22-char base64url — §5)
  bytes            bigint       (ciphertext body size, quota accounting)
  ciphertext_hash  bytea(32)    (SHA-256 of the stored body)
  created_at       timestamptz  (server-side receipt time)

  PRIMARY KEY (account_id, blob_id)
```

- The table is four things at once: **quota ledger** (bytes join
  `sync_accounts.total_bytes`), **existence check** without an S3 round
  trip, **listing backing** (§7.4), and the **purge inventory** for the
  deferred account-deletion workstream (§19).
- **`created_at` exists here, unlike `sync_records`.** The record table
  stores no receipt times because the blind-index design goes out of its way
  to hide *content-creation* time. A blob upload's receipt time is a live
  observable the server has anyway (§6); persisting it costs nothing new and
  earns the reconcile sweep (§19) its "older than the grace window" guard.
  Stated as a decision, not an accident.
- **The object store is pure byte storage.** S3 object key:
  `<account_id>/<blob_id>`. No metadata, no MIME type, no tags on the
  object. What the bucket leaks is what the DB row already states: account,
  opaque id, size, upload time.
- **Quota accounting** updates `sync_accounts.total_bytes` by delta in the
  same transaction as the `sync_blobs` insert/delete, under the same
  `SELECT … FOR UPDATE` on the `sync_accounts` row that serialises record
  batches (sync spec §4) — blob writes and record batches cannot race the
  counter.

## 5. The blob envelope (`packages/crypto`)

A new pure module beside the record envelope — `sync-blob.ts`, WebCrypto
end to end, testable in Bun and the browser alike:

```
blobId     = mintBlobId()          // 16 random bytes, base64url (22 chars)
key        = deriveDek(mk, 'sync/blobs-v1')
nonce      = 12 random bytes       (fresh per seal, never reused)
aad        = utf8('chatsundere-blob-v1') || utf8(blobId)
body       = nonce || AES-256-GCM(key, nonce, blobBytes, aad)
hash       = SHA-256(body)         // → x-ciphertext-hash header
```

Exports (names indicative): `mintBlobId()`, `sealBlob(mk, blobId, bytes)` →
`{ body, hash }`, `openBlob(mk, blobId, body)` → bytes.

- **No blind-index layer for blobs — by decision, not omission.** Record
  keys need HMAC blinding because they are meaning-bearing (uuidv7 embeds a
  creation timestamp). A `blobId` is random from birth: 128 bits of entropy,
  no relationship to content or time. Blinding would hide nothing that is
  not already hidden.
- **The AAD binds the `blobId` and the version tag** — the record envelope's
  anti-swap discipline, continued: the server cannot serve blob X under id
  Y (the GCM open fails), and a future `blob-v2` can never be confused with
  v1. The AAD needs no collection binding: the reference lives *inside* the
  referencing record's authenticated ciphertext, which already binds it to
  its collection and row.
- **Nonce prepended to the body** rather than carried as a column or header:
  the S3 object is self-contained (what is stored is what is fetched), and
  the hash covers nonce + ciphertext together.
- **All metadata stays in the record.** `mime`, `width`, `height`, `crop`,
  `genMeta` are already fields on the referencing rows and travel in their
  record envelopes. The blob object is an opaque byte string.
- **No padding for blobs — by decision, not omission.** The
  intensity-of-use inference that justifies padding on `personas`/`memory*`
  does not transfer to image sizes, and power-of-two padding on multi-MiB
  files would burn real quota and bandwidth. What the server learns is
  stated honestly in §6. The three collections' *record rows* are likewise
  unpadded (consistent with `messages`).
- **Nonce bound, documented:** one DEK (`sync/blobs-v1`) with random 96-bit
  nonces is subject to the NIST SP 800-38D ~2³² invocation bound —
  unreachable for realistic image volumes; recorded as the same rotation
  trigger as the record envelope's (sync spec §19).

### 5.1 `BlobRef` and the wire-row shapes (`packages/shared-types`)

The envelope codec's position is unchanged: `Blob` values remain
unrepresentable by design. On the wire, the three collections' rows replace
their `Blob` fields with references:

```ts
interface BlobRef {
  blobId: string;   // 22-char base64url
  bytes: number;    // ciphertext body size (matches sync_blobs.bytes)
}
```

| Collection | Local field | Wire field |
|---|---|---|
| `artefacts` | `blob?: Blob` | `blobRef?: BlobRef` |
| `artefacts` | `thumbBlob?: Blob` | `thumbBlobRef?: BlobRef` |
| `attachments` | `blob?: Blob` | `blobRef?: BlobRef` |
| `personaAvatars` | `blob: Blob` | `blobRef: BlobRef` |

The transform (strip the `Blob`, attach the `BlobRef`) is the client
engine's job before sealing — the same place the device-local strip already
lives (sync spec §12.5). `bytes` is carried so the engine can make fetch
decisions (progress, wifi-only thresholds, quota display) without a server
round trip.

### 5.2 The three collections join the record allowlist

`personaAvatars`, `artefacts`, `attachments` enter the server's collection
allowlist (sync spec §5.4). Keying for the blind index: `artefacts` and
`attachments` by `id` (uuid); `personaAvatars` by its primary key
`personaId` (uuid, 1:1 with the persona) — §5.1 of the sync spec applies
unchanged. `voiceAudio` remains excluded forever (transient LRU,
rebuildable).

## 6. Threat-model addendum — honest boundaries

Extending the sync spec's §6 for the blob channel:

**What the server (and the bucket) learns:** per account, the number of
blobs, each blob's exact ciphertext size, upload/fetch/delete timing, and
access patterns (which opaque ids a device fetches, when). It does **not**
learn content, MIME type, dimensions, whether a blob is an original or a
thumbnail, or which persona/chat/message it belongs to — all of that lives
inside record ciphertext. Size correlation is real (a ~40 KiB object *looks
like* a thumbnail); accepted and stated, per the no-padding decision (§5).

**What a malicious server can do:** exactly the sync spec's §6.2 boundary,
extended — it can withhold, destroy, or roll back blobs, and serve a blob
under the wrong id (detected: AAD), or serve garbage (detected: GCM). It
cannot read, forge, or swap content. Integrity-of-history defences remain
consciously post-beta.

**Blast-radius note:** a stolen token can delete blobs (the server cannot
check references it cannot see). Bounded the same three ways as record
tombstones: deletes count against the shared per-account delete-rate
ceiling (§7.3), revoked sessions die at the deny-list (sync spec §9), and
devices that already hold the data keep it (local copies + the client-side
trash grace window for pulled tombstones).

## 7. Protocol

Four endpoints under the sync namespace. Auth on every one: Bearer JWT,
JWKS-verified, deny-list-checked — inherited verbatim from the record
channel.

### 7.1 Upload

```
PUT /api/v1/sync/blobs/:blobId
  Content-Type: application/octet-stream
  Content-Length: <bytes>            (required — chunked encoding refused)
  x-ciphertext-hash: <base64url SHA-256 of the body>
  body: the sealed blob (nonce || ciphertext), streamed
```

Server pipeline, in order:

1. Validate `blobId` (exactly 22 base64url chars decoding to 16 bytes) →
   else `400`.
2. `Content-Length` present → else `411`; ≤ `MAX_BLOB_BYTES` → else
   `blob_too_large` — **before a byte flows towards S3**.
3. Quota pre-check: `total_bytes + Content-Length ≤ ACCOUNT_QUOTA_BYTES` →
   else `quota_exceeded` with `{ usedBytes, quotaBytes }` (the record
   channel's constructive payload, verbatim).
4. Existence check against `sync_blobs`: present with the **same hash** →
   `200` (idempotent retry after a dropped connection — nothing re-stored,
   nothing double-counted); present with a **different hash** →
   `blob_exists` (immutability is enforced, never overwrite).
5. Stream the body to S3 while counting bytes and hashing incrementally.
   Byte count ≠ `Content-Length` or computed hash ≠ header → abort, delete
   the S3 object best-effort, record nothing, return `hash_mismatch` (or
   `400` for the length lie).
6. Insert the `sync_blobs` row and bump `sync_accounts.total_bytes` in one
   transaction → `201`.

The S3-write-then-DB-commit order is deliberate: a crash between the two
leaves an S3 object **without** a DB row — invisible to quota and to GET,
cleaned by the reconcile sweep (§19). The opposite order could mint quota
charges for bytes that were never stored.

Two devices racing the same `blobId` (possible only via replay of the same
outbox entry) resolve via the existence check + the uniqueness constraint:
one wins, the other lands in the idempotent-`200` path; the quota is bumped
once.

### 7.2 Download

```
GET /api/v1/sync/blobs/:blobId
→ 200, application/octet-stream, Content-Length set, body streamed
→ 404 (unknown id — including another account's id: scoping is absolute)
```

- Streams from S3 through the service; no full buffering.
- `Cache-Control: no-store` — the engine persists decrypted bytes into
  Dexie; letting the browser's HTTP cache hold a second (ciphertext) copy
  would double storage for nothing. A decision, revisitable if fetch
  patterns ever change.
- A DB row whose S3 object is missing (backup skew, §17.7) → `404` plus an
  inconsistency metric; the engine treats it as a missing blob (§12).

### 7.3 Delete

```
DELETE /api/v1/sync/blobs/:blobId
→ 204 (idempotent — absent id is also 204)
```

- Deletes the DB row and the S3 object, frees the quota bytes.
- **Counts against the same per-account delete-rate window as record
  tombstones** (`RATE_LIMIT_DELETE_PER_MIN`): the destruction-bounding
  rationale applies with full force — a stolen token must not be able to
  erase an image archive in one burst. Over the window →
  `delete_rate_limited` (retriable); the engine spreads legitimate bulk
  deletes exactly as it does tombstones.

### 7.4 Listing

```
GET /api/v1/sync/blobs
→ 200 { blobs: [{ blobId, bytes }], totalBytes, quotaBytes }
```

Account-scoped inventory. Three consumers: the client's quota/usage display,
the engine's epoch-recovery blob reconciliation (§12), and the engine's
future orphan sweep. Deliberately unpaginated in v1 — at 2 GiB / ~40 KiB
minimum-interesting-blob the worst case is tens of thousands of tuples of a
few dozen bytes; a `more` cursor can be added compatibly if reality
disagrees.

### 7.5 Error vocabulary

With HTTP statuses pinned (the record channel returns per-record outcomes
inside a `200` batch; blob requests stand alone, so the status carries
meaning):

| Code | HTTP | Meaning |
|---|---|---|
| `blob_too_large` | `413` | `Content-Length` over `MAX_BLOB_BYTES` |
| `quota_exceeded` | `507` | with `usedBytes`/`quotaBytes` payload |
| `blob_exists` | `409` | id taken with a different hash (immutability) |
| `hash_mismatch` | `400` | body did not hash to `x-ciphertext-hash` |
| `not_found` | `404` | unknown id (including foreign accounts' ids) |
| `delete_rate_limited` | `429` | shared delete window tripped (retriable) |
| `blob_backend_unavailable` | `503` | S3 configured but unreachable |
| `blobs_disabled` | `501` | no S3 configured on this instance |

Plus the generic `400` (malformed `blobId`, byte-count/length mismatch) and
`411` (missing `Content-Length`). Wire format and constructive-error
discipline as the record channel.

## 8. Hardening & observability

- **Rate limits:** blob routes ride the existing per-IP pre-auth and
  per-user post-auth windows (`RATE_LIMIT_IP_PER_MIN`,
  `RATE_LIMIT_USER_PER_MIN`); deletes additionally ride
  `RATE_LIMIT_DELETE_PER_MIN` (§7.3). No new knobs.
- **Streaming discipline:** the service never holds a whole blob in memory —
  request bodies stream to S3 with incremental hashing/counting; responses
  stream from S3 with backpressure. Probed before plan lock-in (§21).
- **Degradation:** S3 unreachable at runtime → `503
  blob_backend_unavailable` on blob routes **only**; the record channel is
  untouched; `readyz` stays green (S3 liveness becomes a metric, not a
  readiness criterion — an operator's object-store hiccup must not take
  record sync down).
- **Bucket bootstrap:** at boot, with S3 configured, the service creates the
  bucket if absent (idempotent) — one operator hand-step fewer. S3
  unreachable at boot does **not** block startup: log, expose the metric,
  retry in the background, serve records meanwhile.
- **Metrics** (anonymity invariant upheld — no `account_id`/`blob_id`
  label, ever): upload/download/delete counters and byte histograms, errors
  by code, S3 backend errors, an S3-liveness gauge, and the DB/S3
  inconsistency counter (§7.2). `/metrics` on `OPS_PORT` only, as ever.
- **Logging:** structured, ciphertext-blind, no account/blob identifiers —
  the record channel's log discipline verbatim.

## 9. Authentication

Inherited wholesale from the sync spec §9: Bearer JWT pinned to `EdDSA`
via JWKS, `jti`/`sub` deny-list check on every request (revocation applies
to blob traffic within the same second), no cookies, no CSRF surface.

## 10. Backend discovery — the `"blobs"` feature flag

`GET /api/v1/config` (auth-service) gains `"blobs"` in its `features` array
when the operator has configured the sync-service's S3 backend, signalled
via a new auth-service env mirror (`SYNC_BLOBS_ENABLED`, see §14 — the
config endpoint lives in auth-service and must not probe sync-service at
request time). `syncUrl` is unchanged. Clients that see `"sync"` without
`"blobs"` show the honest records-only boundary (placeholders + copy);
self-hosters get blob sync the moment they add MinIO to their compose.

## 11. Collection dispositions (engine contract input)

The sync spec's §12.1 discipline, extended to the three joining
collections — pinned here so the engine session inherits decisions, not
questions:

| Collection | Disposition |
|---|---|
| `artefacts` | Creation is a Class-1 insert (fresh uuid, complete at birth). `title`/`fileName`/`tags`/`favourite` edits are Class 2. `blob`/`thumbBlob` never change after creation (an image artefact is immutable content; renames touch metadata only). |
| `attachments` | Sync **only once `messageId` is set** (sent) — a pending compose attachment is device-local transient state, exactly like lazy-chat drafts. From send, the row is a Class-1 append riding its message. `state: 'deleted'` soft-deletes are Class-2 edits. `visionDescription` is a Class-2 background-job edit (cache — converges via CAS like `lastExtractedMessageId`). |
| `personaAvatars` | Insert Class 1 with a new persona's avatar; replacing an avatar is Class 2 (new `blobId` + row update + old-blob delete); `crop` edits are Class 2 (row-only — the blob is untouched). |

## 12. The client engine — the blob contract (built later, like §12 there)

The engine session (Dexie v33, outbox, worker — sync spec §12) additionally
implements, against this server:

- **Ordering, push:** blob PUT **before** the record push that references
  it. A puller must never resolve a committed record to a blob the server
  has not seen (transient races excepted — see the inert-retry rule below).
  Blob uploads are retriable and idempotent (§7.1), so they queue in the
  outbox exactly like Class-1 appends.
- **Ordering, delete:** record tombstone **before** blob DELETE. An orphaned
  blob is harmless (quota-charged until swept); a dangling reference is a
  user-visible hole.
- **Dangling refs resolve inertly:** a `blobRef` whose GET returns 404 shows
  the placeholder state and schedules a retry; it never fails the record's
  application. If the local device still holds the bytes, it repairs — with
  a case split that matters: when the server has **no row** for the id
  (absent from the listing — epoch recovery, lost DB), re-upload under the
  **same** `blobId` (a fresh seal under the same id is fine — the AAD binds
  the id, not the old nonce). When the server **has the row but lost the
  object** (backup skew: GET 404s yet the listing shows the id), a re-PUT
  would trip `blob_exists` (a fresh seal hashes differently) — repair with a
  **fresh `blobId`** plus a Class-2 record update carrying the new ref, then
  DELETE the skewed id.
- **Epoch recovery includes blobs:** on an `instance_epoch` change, after
  the record recovery (sync spec §12.2), the engine diffs local `blobRef`s
  against `GET /api/v1/sync/blobs` and re-uploads what the server lost
  (same-id case above).
- **Trash interplay:** a pulled tombstone routes the row to the client-side
  trash *with its local blob bytes* — the 30-day grace window keeps images
  restorable. Restore mints a new uuid **and a new `blobId`** and re-uploads
  (terminality respected on both channels).
- **Fetch strategy is UX territory, decided with Laura in the engine
  session:** the server supports any policy. The design intent behind
  decision 4 (§2): thumbnails + avatars eager, artefact originals and
  attachment images lazy-on-view with placeholder + progress affordances.
  Wifi/metered heuristics, prefetch bounds, and placeholder copy are hers to
  audit, not this spec's to fix.
- **Uplevelling** (local plaintext → linked account, in-place merge) pushes
  local blobs up under fresh `blobId`s as part of the union — deferred with
  the uplevelling workstream, named here.

## 13. Error handling

Client-facing failures follow the constructive-error house rule: every blob
error carries the next step (`quota_exceeded` → what to free or raise;
`blob_backend_unavailable` → "the operator's object store is down, your data
is safe locally, we retry"). Server-side: per-request failures never poison
neighbours (each blob request stands alone — there is no batch to protect).

## 14. Configuration (env)

| Var | Service | Meaning |
|---|---|---|
| `S3_ENDPOINT` | sync | S3-compatible endpoint, e.g. `http://minio:9000`; **unset ⇒ blobs disabled** |
| `S3_REGION` | sync | default `us-east-1` (MinIO ignores it, AWS needs it) |
| `S3_BUCKET` | sync | default `chatsundere-blobs`; created at boot if absent |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | sync | credentials (secret; pino-redacted) |
| `S3_FORCE_PATH_STYLE` | sync | default `true` (MinIO); `false` for AWS virtual-host style |
| `MAX_BLOB_BYTES` | sync | default `33554432` (32 MiB ciphertext body) |
| `ACCOUNT_QUOTA_BYTES` | sync | **default raised to `2147483648` (2 GiB)** — shared records + blobs (amends sync spec §7.4/§14) |
| `SYNC_BLOBS_ENABLED` | auth-service | mirrors S3 presence for the `/api/v1/config` `"blobs"` flag (§10) |

`.env.example` updated for both services; MinIO joins
`infra/docker-compose.dev.yml` (dev credentials, healthcheck) and the prod
compose example (internal network only, named volume, healthcheck, no
published port).

## 15. Wire reference (concrete shapes for `curl` verification)

`tools/seal-cli.ts` grows `blob-seal` / `blob-open` subcommands (mint a
blobId, seal a file, print body + hash to disk/stdout) — hand-crafting
AES-GCM bodies is still not a thing.

```
# Upload (device 1)
bun tools/seal-cli.ts blob-seal --mk <b64url> --in cat.jpg --out cat.sealed
# → prints blobId + x-ciphertext-hash
curl -X PUT https://sync.chatsundere.me/api/v1/sync/blobs/<blobId> \
  -H 'Authorization: Bearer <JWT>' \
  -H 'Content-Type: application/octet-stream' \
  -H 'x-ciphertext-hash: <b64url>' \
  --data-binary @cat.sealed
# → 201 · re-run → 200 (idempotent)

# Download + open (device 2)
curl https://sync.chatsundere.me/api/v1/sync/blobs/<blobId> \
  -H 'Authorization: Bearer <JWT2>' -o cat.sealed.pulled
bun tools/seal-cli.ts blob-open --mk <b64url> --blob-id <blobId> \
  --in cat.sealed.pulled --out cat.pulled.jpg
# → byte-identical to cat.jpg

# Inventory · Delete
curl https://sync.chatsundere.me/api/v1/sync/blobs -H 'Authorization: …'
curl -X DELETE https://sync.chatsundere.me/api/v1/sync/blobs/<blobId> \
  -H 'Authorization: …'   # → 204, quota freed; GET → 404
```

## 16. Scope boundary — the seam

**IN (this spec's implementation run, headless):**

- `sync-service`: the four blob routes with the streaming pipeline, quota
  integration, shared delete-rate window, `sync_blobs` migration, bucket
  bootstrap, degradation, metrics, rate limits.
- `packages/crypto` `sync-blob.ts` (`mintBlobId`/`sealBlob`/`openBlob`) —
  pure, TDD-ideal, WebCrypto parity.
- `packages/shared-types`: `BlobRef`, the three wire-row types, error codes.
- Server allowlist extension: `personaAvatars`, `artefacts`, `attachments`.
- `apps/auth-service`: the `"blobs"` config flag (`SYNC_BLOBS_ENABLED`).
- `infra/`: MinIO in dev compose + prod example.
- `tools/seal-cli.ts` blob subcommands.
- `obsidian/DEPLOYMENT.md` (§17) — written against the built services.
- **Larissa re-audits the built diff before squash** (sync-service +
  `packages/crypto` are mandatory paths).

**OUT (later sessions, contracts named):**

- The client engine's blob half (§11/§12): `BlobRef` transform, outbox
  ordering, fetch strategy (Laura-gated UX), trash/restore re-upload, the
  orphan sweep, quota display.
- Blob uplevelling (with the uplevelling workstream).
- The DB/S3 reconcile sweep and the account-deletion purge (§19).
- The full-build cutover (Chris's v0.2.0 go-live, coordinated proxy cut,
  Discord announcement) — the next session's event; it *consumes*
  `DEPLOYMENT.md` (§17), never duplicates it.

**Sequencing, hard:** this builds on the sync-service produced by the
`feat/backend-02-sync` run. Branch **`feat/backend-03-blobs`**, strictly
after 02 has merged to master. The kickoff prompt carries a STOP-guard
(e.g. `apps/sync-service/src/routes/` exists and the sync test suite is
green on the base) — the 02-after-01 discipline, repeated.

## 17. Deployment documentation — `obsidian/DEPLOYMENT.md`

The second half of Block 6C. Home: `obsidian/DEPLOYMENT.md` — the slot
reserved since Phase 0 (CLAUDE.md §6/§15). Audience: **Chris and third-party
operators alike** — AGPLv3 self-hosting is first-class, and the deredere
posture extends to operators: every chapter tells the reader the next
constructive step, never gatekeeps. British English; linkable from the
public site when we choose to surface it.

Relationship to the full-build session: `DEPLOYMENT.md` documents *the
system* (durable reference, any operator); the full-build session plans *the
event* (Chris's specific v0.2.0 cutover) and consumes this document.

Chapter structure (fixed here so the plan's doc tasks are mechanical):

1. **Architecture overview** — the services (auth, proxy, sync, Postgres,
   Redis, MinIO) and who talks to whom; public vs ops port split; one public
   origin, MinIO strictly internal.
2. **The zero-knowledge posture — what you can and cannot see.** Front and
   centre, the identity chapter: an operator holds ciphertext only, never
   passphrases, plaintext, or image content — and that protects the
   *operator* too ("you cannot leak what you cannot read").
3. **Prerequisites** — VPS sizing guidance, Docker Compose, domain + TLS
   (Traefik as the reference front, any reverse proxy viable).
4. **Configuration reference** — every env var per service: purpose, format,
   example, secret-or-not, key-generation commands. Kept congruent with
   `.env.example` (congruence is part of the definition of done).
5. **Compose walkthrough** — the annotated production compose example.
6. **Bootstrap** — first start, migrations, `bootstrap-admin` CLI, first
   invitation, how clients discover the instance (`GET /api/v1/config`).
7. **Operations** — Prometheus scrape targets, structured logs, upgrades
   (tag-gated images, Watchtower scoping), **backups & restore**: Postgres +
   the MinIO bucket are the backup pair (take them close together; skew
   self-heals via client re-upload but is worth avoiding), Redis is safe to
   lose; and the honest `instance_epoch` consequence — restoring from backup
   flips the epoch and sends every client through recovery (local data wins
   its way back up; documented so an operator is not alarmed).
8. **Scaling honesty** — single-replica is the v1 reality (in-process
   doorbell registry); said plainly, not vaguely promised away.
9. **Troubleshooting** — the common failure shapes, each with its next
   constructive step.
10. **Operator security checklist** — ops ports never public, secrets
    hygiene, TLS, deny-list dependency on shared Redis, what to do on
    suspected compromise.

The document is written **after** the implementation tasks in the plan, so
env names, defaults, and behaviours are verified against the built services
(empirical truth over spec belief).

## 18. Testing (Bun runner; crypto in the packages/crypto vitest suite)

- **Envelope:** seal/open round-trip with real multi-MiB bytes; AAD tamper
  matrix (foreign `blobId`, v2 tag → open fails); foreign MK fails; nonce
  uniqueness across seals; hash covers nonce + ciphertext; `mintBlobId`
  shape (22 base64url chars, 16 bytes); WebCrypto parity Bun/browser.
- **PUT:** happy path → `201` + row + quota bump; missing `Content-Length` →
  `411`; header over cap → `blob_too_large` with **zero S3 traffic**
  (asserted via the S3 test double); actual bytes ≠ header → abort, nothing
  recorded, S3 object cleaned; hash mismatch → likewise; quota edge (exact
  fit passes, +1 byte → `quota_exceeded` with `usedBytes`/`quotaBytes`);
  idempotent re-PUT (same hash → `200`, **no double count**); different
  hash → `blob_exists`, stored object untouched; two concurrent PUTs of one
  `blobId` → one `201`, one `200`, quota bumped once; invalid `blobId`
  shapes → `400`.
- **GET:** byte-identical round-trip at cap size; unknown id → `404`;
  **another account's id → `404`** (absolute scoping); DB row without S3
  object → `404` + inconsistency metric; `Cache-Control: no-store`.
- **DELETE:** frees quota; idempotent (`204` on absent); **a mix of record
  tombstones and blob deletes trips the same
  `RATE_LIMIT_DELETE_PER_MIN` window** while ordinary writes are unaffected.
- **Listing:** account-scoped ids + bytes + totals; empty account → empty
  list.
- **Shared quota:** records and blobs jointly cross `ACCOUNT_QUOTA_BYTES`;
  a blob delete makes room for a record push and vice versa.
- **Allowlist:** the three collections accepted on the record channel; a
  sealed `personaAvatars` row keyed by `personaId` round-trips; wire rows
  carry `blobRef`s, never `$bytes`-encoded image payloads (size assertion).
- **Degradation:** no `S3_ENDPOINT` → `blobs_disabled` + flag absent from
  config; S3 endpoint down → `503 blob_backend_unavailable` on blob routes,
  record push/pull green in the same test run; boot with S3 down → service
  starts, records serve.
- **Auth matrix inherited:** valid / expired / deny-listed / tampered /
  wrong-algorithm → `401` on every blob route.
- **Anonymity invariant:** no log line, no metric label carries
  `account_id`/`sub`/`jti`/`blob_id`; S3 credentials pino-redacted.
- **Ops split:** blob metrics on `OPS_PORT` only.
- **Config flag:** `"blobs"` present ⇔ `SYNC_BLOBS_ENABLED`.
- **seal-cli:** blob-seal → PUT → GET → blob-open round-trip through the
  real server as an integration test.

## 19. Open points / deferred

- **Reconcile sweep** (S3 objects without DB rows — crash mid-upload; DB
  rows without objects — backup skew): a named deferral, like the account
  purge. The `<account_id>/<blob_id>` key scheme + `created_at` grace guard
  make it a mechanical list-and-diff when it lands. Until then the leak is
  bounded: quota never counts invisible objects, and per-object size is
  capped.
- **Account-deletion purge** now spans `sync_db` *and* the bucket; the
  `sync_blobs` table is the ready-made inventory. Still owned by the
  account-lifecycle workstream.
- **Client-side orphan sweep** (blobs no local row references — engine
  crash between tombstone and delete): engine session, using §7.4's listing.
- **Quota default (2 GiB) and `MAX_BLOB_BYTES` (32 MiB)** are first guesses;
  tune against real usage, like the record ceilings.
- **Listing pagination** — add a cursor compatibly if inventories ever grow
  past sanity (§7.4).
- **Per-blob-size padding** — revisit only if size correlation ever proves
  to matter in practice; the seam is the `blob-v2` AAD tag.
- **Multi-replica** — the blob path is stateless per request and would scale
  before the doorbell does; noted, not built.

## 20. Manual verification (Chris, on the VPS dry-run)

Extends the sync spec's §18 list:

1. Compose up with MinIO → `docker compose ps` healthy; bucket auto-created;
   MinIO reachable **only** from the compose network (no published port).
2. `seal-cli blob-seal` an image → PUT as device 1 (`201`) → re-PUT (`200`)
   → GET as device 2 → `blob-open` → **byte-identical**.
3. `GET /api/v1/sync/blobs` shows the blob + shared totals; push records
   until the shared quota trips → `quota_exceeded` names used/quota.
4. DELETE → `204`, GET → `404`, listing shows the freed bytes.
5. Burst > 60 mixed deletes (records + blobs) in a minute →
   `delete_rate_limited` on the tail; ordinary pushes unaffected.
6. Stop MinIO → blob GET → constructive `503`; record push/pull still green;
   start MinIO → blob routes recover without a service restart.
7. `mc ls` the bucket: opaque keys, no MIME, no metadata; `psql sync_db`:
   `sync_blobs` shows only ids/sizes/hashes.
8. `GET /api/v1/config` → `features` includes `"blobs"`; unset
   `SYNC_BLOBS_ENABLED` → flag gone.
9. Internal `/metrics` → blob counters present, **no account/blob labels**.
10. Logout the device → its blob PUT/GET → `401` within the second.

## 21. Probes before plan lock-in

House discipline — empirical checks the plan runs before tasks lock:

1. **Bun's native S3 client vs `@aws-sdk/client-s3` against MinIO** —
   streaming PUT with known length, streaming GET, path-style addressing,
   idempotent bucket creation, error shapes on a dead endpoint. The winner
   is chosen empirically, not from docs.
2. **Hono/Bun request-body streaming at 32 MiB** — memory profile
   (no full buffering), incremental SHA-256 while consuming the stream,
   abort semantics on client disconnect mid-upload (is the partial S3 write
   observable? does the delete-best-effort path run?).
3. **GET passthrough S3 → client** — backpressure behaviour, memory under a
   slow reader, `Content-Length` propagation.
4. **`Content-Length` in Bun/Hono** — is it surfaced pre-body reliably; are
   chunked-encoding requests distinguishable and refusable.
5. **MinIO container bootstrap** — healthcheck endpoint, root-credential
   env, bucket creation from Bun, behaviour when the bucket already exists.
6. **WebCrypto AES-GCM single-shot at 32 MiB in the browser** — seal/open
   time and memory on a mid-range phone-class budget (realistic payloads are
   single-digit MiB, but the cap must be covered or lowered).
