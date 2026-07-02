# WS-D — Blob Client (design)

**Date:** 2026-07-02 · **Workstream:** D of the Full Backend Transition (STATUS-TRANSITION §4) — rides on WS-C
**Depends on:** WS-C sync engine (outbox, worker, apply pipeline, trash, epoch recovery, copy catalogue), built server side (blob routes on sync-service, `packages/crypto` sync-blob, `BlobRef` wire types)
**Audit:** **Larissa** (blob envelope consumption, hash/ordering discipline) + **Laura** (placeholders, progress, quota copy)
**Server counterpart:** `superpowers/specs/2026-07-02-blob-transport-and-deployment-docs-design.md` — §5 (envelope + `BlobRef`), §7 (protocol), §11 (collection dispositions), §12 (the client contract this spec implements).

## 1. Why

Records sync in WS-C, but the three blob-bearing collections
(`personaAvatars`, `artefacts`, `attachments`) are inert-skipped there —
their rows carry multi-MiB `Blob` fields the record envelope deliberately
cannot represent. The server's blob transport (S3/MinIO, deterministic
sealed bodies, idempotent PUTs) is built and audited. This workstream makes
the engine speak it: the `BlobRef` transform, upload/download ordering,
repair, trash and epoch interplay, and the fetch strategy.

## 2. Decisions settled with Chris (2026-07-02)

1. **Fetch strategy v1 is simple:** thumbnails and avatars eager at apply;
   artefact originals and attachment images lazy-on-view with placeholder
   and progress affordances. **No metered/wifi heuristics, no prefetch
   settings surface** — YAGNI until a user asks.
2. **Quota display lives in the WS-C status line** (account page): a second
   line "X of Y storage used", sourced from the blob inventory endpoint.
   No dedicated screen.

## 3. Architecture — extends `apps/user-client/src/sync/`

| Module | Responsibility |
|---|---|
| `blob-transport.ts` | binary PUT/GET/DELETE/LIST against `<syncUrl>/api/v1/sync/blobs` — bearer + one 401-refresh-retry (the record channel's discipline, binary bodies) |
| `blob-transform.ts` | per-collection seal-side strip (`Blob` fields → `BlobRef` fields) and apply-side handling; the §5.1 field table below is its single source of truth |
| `blob-fetch.ts` | the fetch strategy: eager queue (concurrency-limited), lazy-on-view resolver, retry/backoff, 501 suppression |
| `blob-repair.ts` | the §7 residual cases: repair PUTs, fresh-id repair, corrupt-body handling |

Consumed, never re-implemented: `mintBlobId()`, `sealBlob(mk, blobId,
bytes)` → `{ body, hash }`, `openBlob(mk, blobId, body)` from
`@chatsundere/crypto` (deterministic SIV-style sealing — re-seals of the
same `(blobId, plaintext)` are byte-identical, which is what makes every
repair path below a plain idempotent re-PUT); `BlobRef` from
`@chatsundere/shared-types`.

WS-C's v1 "unhandled collection" skip for the three collections is
**removed**: they join the handled set with the §5 transforms and WS-C's
§7 conflict rules extended by the blob-spec §11 keys (`artefacts` and
`personaAvatars` LWW on existing `updatedAt`; `attachments` LWW on the
engine-stamped `updatedAt` that WS-C's v33 migration already added).

## 4. Local row shape — refs beside bytes, no Dexie bump

Rows keep their local `Blob` bytes AND gain the persisted ref fields
(non-indexed → **no schema version; v33 stays untouched**):

| Collection | Local bytes | Ref field (new, persisted) |
|---|---|---|
| `artefacts` | `blob?: Blob` | `blobRef?: BlobRef` |
| `artefacts` | `thumbBlob?: Blob` | `thumbBlobRef?: BlobRef` |
| `attachments` | `blob?: Blob` | `blobRef?: BlobRef` |
| `personaAvatars` | `blob: Blob` | `blobRef: BlobRef \| null` |

- **Seal-side** (`blob-transform.ts`, running inside WS-C's §10 strip
  step): ensure every present `Blob` has a ref (mint id on first push),
  strip the `Blob` fields, attach the refs. The wire row never carries
  bytes.
- **Apply-side:** store the pulled row with its refs; bytes arrive per the
  fetch strategy (§6). A row whose ref is present but bytes are absent is
  the **placeholder state** — first-class, not an error.
- `BlobRef.bytes` (ciphertext size) drives progress display without a
  server round trip.
- **Avatar removal is `blobRef: null`, never a tombstone** (blob spec §5.1
  terminality trap — `personaAvatars` is keyed by the stable `personaId`;
  a tombstone would brick avatar sync for that persona forever). The
  tombstone is reserved for the persona-deletion cascade.

## 5. Outbox extension and ordering

`SyncOutboxRow.op` gains `'blob-put' | 'blob-delete'`, plus an optional
`blobId: string` (set for blob ops; `key` stays the owning record's sync
key so cascades and coalescing group naturally).

**Enqueue rules** (same-transaction discipline as WS-C §5):

- Creation with bytes (new artefact image, sent attachment, new avatar):
  enqueue `blob-put`(s) + the record upsert in the row's transaction.
- Avatar replace / text-artefact edit with new image (Class 2 via
  `mutateSynced`): `blob-put` (new id) + record upsert + `blob-delete`
  (old id).
- User-reachable deletes and cascades (chat → attachments + artefacts;
  persona → avatar): record tombstones + `blob-delete`s per blob-spec §11.
- Coalescing: `blob-put` + `blob-delete` for the same never-pushed blobId
  cancels to nothing (mirror of WS-C's create+delete rule).

**Drain phase order (blob spec §12, load-bearing):**

1. **`blob-put`s first** — a puller must never resolve a committed record
   to a blob the server has not seen. Bytes are read from the live row (or
   the trash row if the record moved there since); bytes nowhere locally →
   drop the entry with a diagnostic (nothing to upload is not an error
   loop).
2. Record upserts, then record tombstones (WS-C's existing phases).
3. **`blob-delete`s last** — an orphaned blob is harmless (quota-charged
   until deleted); a dangling reference is a user-visible hole.

A failed `blob-put` (network, quota) blocks **its record's upsert** in the
same cycle (ordering) but never the rest of the queue. `413
blob_too_large` is **permanent for that blob**: the entry is marked failed
with catalogue copy naming the operator's limit (§9), and — named
consequence — the record then syncs without server-side bytes; other
devices show its placeholder indefinitely. Better an honest placeholder
than a permanently wedged queue.

## 6. Fetch strategy (decision 1)

- **Eager, at apply:** `thumbBlobRef` (artefacts) and `personaAvatars`
  refs enter a fetch queue — concurrency 3, FIFO, retry with backoff.
  Chat streams and the persona hub thus populate without user action.
- **Lazy, on view:** artefact originals and attachment images fetch when
  their surface first renders the row (lightbox open, artefact view).
  Placeholder (blurred thumb where one exists, neutral frame otherwise) +
  a progress affordance driven by `BlobRef.bytes`.
- Downloaded bytes are written onto the row's `Blob` field in Dexie (the
  local store IS the cache; no second cache layer), with the usual TanStack
  invalidation for the affected surfaces.
- GET → `openBlob` → GCM/AAD authenticates content against `(MK, blobId)`;
  an open failure is a **corrupt body**, handled by §7, never a partial
  write to the row.

## 7. Inert resolution and repair (blob spec §12, client-concrete)

| Case | Behaviour |
|---|---|
| GET `404` (dangling ref) | placeholder + scheduled retry (backoff); if this device holds the bytes → **repair PUT** (deterministic re-seal, idempotent: `201` row-lost / `200` object-present both heal) |
| repair PUT `409 blob_exists` | stored state is corrupt or foreign (deterministic sealing makes an honest hash mismatch impossible): repair with a **fresh blobId** + a Class-2 record update carrying the new ref, then `blob-delete` the old id |
| GET ok but `openBlob` fails | same fresh-id repair when this device holds the bytes; placeholder + diagnostic when it does not. A corrupt blob never fails or mutates the referencing record's application |
| GET `501 blobs_disabled` | placeholder, **retry suppressed** — disabled is not missing; re-probe only when `/api/v1/config` changes |
| PUT `413 blob_too_large` | permanent per-blob failure (§5), catalogue copy with the operator's `maxBlobBytes` |
| PUT `quota_exceeded` | attention state with `{usedBytes, quotaBytes}` copy (§9); entry retries after space is freed |

## 8. Trash and epoch interplay

- A pulled tombstone routes the row to WS-C's trash **with its local blob
  bytes in the trash row** — images stay restorable through the 30-day
  window. Restore (dev-tools in v1) mints a new uuid **and new blobIds**
  and re-uploads (terminality respected on both channels). WS-C's
  trash-anchored terminality guard (H-1) applies unchanged to the three
  collections.
- Pending `blob-put`s for a tombstoned record are dropped with the record's
  outbox entries; `blob-delete`s from the tombstone cascade still run
  (phase 3).
- **Epoch recovery extends WS-C §8:** after the record recovery, diff local
  refs against `GET /api/v1/sync/blobs` (the inventory) and re-PUT what the
  server lost — plain idempotent re-PUTs under deterministic sealing. Runs
  inside the same rate-limited recovery cycle, never separately.

## 9. Quota display and copy (decision 2)

- The WS-C status line gains a second row on the account page: "X of Y
  storage used" from the inventory endpoint (fetched on page mount and
  after quota errors — not polled).
- Copy joins WS-C's `sync/copy.ts` catalogue: `quota_exceeded` (already
  specified there — blob PUTs reuse it), `blob_too_large` ("This image is
  larger than your server accepts (limit: N MB). It stays on this
  device."), and the placeholder/progress strings.

## 10. UX surfaces (Laura)

- Placeholder states: blurred thumbnail where a thumb exists, calm neutral
  frame with file-type glyph otherwise; progress ring driven by
  `BlobRef.bytes`; a failed fetch shows a quiet retry affordance, never a
  broken-image glyph.
- The lazy path must never block the chat stream: messages render with
  placeholders and hydrate in place.
- Quota line copy is informational, not alarming; it names the freeing
  action (delete large items) and the operator path.
- No new screens, no settings surface (decision 1).

## 11. Security invariants (Larissa) `[L]`

1. **Bytes on the wire are `sealBlob` output only**; the plaintext hash
   never leaves the device (it exists only inside the seal computation —
   the built crypto enforces this; the engine must never add a content
   fingerprint header, log line, or dedup key).
2. **`x-ciphertext-hash` is computed locally** from the sealed body at PUT
   time — never copied from a server response.
3. **blobIds are `mintBlobId()` random, never content-derived** — the
   engine must not "optimise" towards content addressing (equality-oracle
   surface).
4. Download integrity rides GCM+AAD (`openBlob` binds MK + blobId): a
   swapped or corrupted body fails closed into §7's repair paths without
   touching the referencing record.
5. Ordering discipline (§5) is an integrity property: no record ever
   commits server-side ahead of its blob except through the named,
   inert-resolved transient races.
6. Blob HTTP uses the same bearer + refresh discipline as the record
   channel; no tokens in URLs; inventory/quota responses carry no
   plaintext metadata to log.

## 12. Out of scope

- Trash restore UI (WS-C follow-up owns it; blob bytes in trash make it
  richer later).
- Wifi/metered heuristics, prefetch bounds, storage-pressure eviction
  (v1 keeps all fetched bytes — matches today's fully-local behaviour).
- Uplevelling blob re-upload (rides the uplevelling workstream).
- Any server change.

## 13. Testing

- `blob-transform.ts`: seal-side strip/ref attachment and apply-side
  passthrough for all four field pairs; avatar `blobRef: null` removal
  (never tombstone).
- Drain ordering: put-before-record, tombstone-before-delete, failed put
  blocks own record only, put+delete coalesce, 413 permanent-fail leaves
  queue flowing.
- Repair matrix: 404-with-local-bytes → re-PUT; 409 → fresh-id + Class-2
  ref update + old delete; open-fail both branches; 501 suppression until
  config change.
- Fetch: eager queue concurrency/backoff, lazy trigger, placeholder →
  hydrate, corrupt body → repair without record mutation.
- Trash: bytes retained in trash rows; pending puts dropped on tombstone;
  epoch recovery inventory diff + re-PUT.
- Full battery: `pnpm typecheck --force` (14/14), full user-client vitest
  (8-failure baseline rule), `pnpm build`, Biome.

## 14. Manual verification (Chris, dev stack + MinIO, two browsers)

1. Dev stack up including MinIO; devices A and B linked (WS-C's setup).
2. Generate an image artefact on A → B shows the thumb eagerly in the
   stream; opening the lightbox on B fetches the original with a progress
   ring.
3. Set a persona avatar on A → it appears on B without interaction.
   Remove it on A → B falls back to the monogram (no tombstone in
   DevTools).
4. Send an image attachment on A → B renders placeholder, then hydrates.
5. Delete the chat on A → B's rows move to trash **with bytes** (DevTools);
   MinIO objects disappear after the drain (delete phase).
6. Delete the S3 object for a blob by hand (MinIO console) → B shows the
   placeholder + retry; A (holding bytes) repairs it on its next cycle; B
   then hydrates.
7. Upload an image larger than `MAX_BLOB_BYTES` → the constructive
   too-large message; the queue keeps flowing (send another message).
8. Fill the quota (small dev quota) → the attention state shows X of Y and
   the freeing action; deleting artefacts frees it and the retry drains.
