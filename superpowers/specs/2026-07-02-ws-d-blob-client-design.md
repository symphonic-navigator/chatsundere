# WS-D — Blob Client (design)

**Version:** v2 — Larissa spec-pass (M-1–M-4, L-1–L-5, I-1–I-3; pin verification CLEAN) and Laura spec-pass (1 hard, 5 soft) folded, 2026-07-02.
**Date:** 2026-07-02 · **Workstream:** D of the Full Backend Transition (STATUS-TRANSITION §4) — rides on WS-C
**Depends on:** WS-C sync engine (outbox, worker, apply pipeline, trash, epoch recovery, copy catalogue, attention state), built server side (blob routes on sync-service, `packages/crypto` sync-blob, `BlobRef` wire types)
**Audit:** **Larissa** (spec-pass done — folded; re-audit of `blob-transport.ts`/`blob-repair.ts` at pre-squash) + **Laura** (spec-pass done — folded; pre-squash walk of §10)
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
| `blob-transport.ts` | binary PUT/GET/DELETE/LIST against `<syncUrl>/api/v1/sync/blobs` — bearer + one 401-refresh-retry (the record channel's discipline, binary bodies), the §6 GET size gate |
| `blob-transform.ts` | per-collection seal-side strip (`Blob` fields → `BlobRef` fields + sentinels) and apply-side handling; §4's field table is its single source of truth; `BlobRef` validation (§11.7) |
| `blob-fetch.ts` | the fetch strategy: eager queue (concurrency-limited, view-priority), lazy-on-view resolver, the §7.1 retry budget, 501/oversized suppression |
| `blob-repair.ts` | the §7 residual cases: repair PUTs, fresh-id repair under the §7.2 cap, proactive heal |

Consumed, never re-implemented: `mintBlobId()`, `sealBlob(mk, blobId,
bytes)` → `{ body, hash }`, `openBlob(mk, blobId, body)` from
`@chatsundere/crypto` (deterministic SIV-style sealing — re-seals of the
same `(blobId, plaintext)` are byte-identical, which is what makes every
repair path below a plain idempotent re-PUT); `BlobRef` from
`@chatsundere/shared-types`.

WS-C's v1 "unhandled collection" skip for the three collections is
**removed**: they join the handled set with the §4 transforms and WS-C's
§7 conflict rules extended by the blob-spec §11 keys (`artefacts` and
`personaAvatars` LWW on existing `updatedAt`; `attachments` LWW on the
engine-stamped `updatedAt` that WS-C's v33 migration already added).

## 4. Local row shape — refs beside bytes, no Dexie bump

Rows keep their local `Blob` bytes AND gain persisted ref/sentinel fields
(non-indexed → **no schema version; v33 stays untouched**):

| Collection | Local bytes | Ref field (new, persisted) |
|---|---|---|
| `artefacts` | `blob?: Blob` | `blobRef?: BlobRef` |
| `artefacts` | `thumbBlob?: Blob` | `thumbBlobRef?: BlobRef` |
| `attachments` | `blob?: Blob` | `blobRef?: BlobRef` |
| `personaAvatars` | `blob: Blob` | `blobRef: BlobRef \| null` |

plus, on the same rows, the **oversize sentinel** `blobOversized?: true`
(per ref field: `thumbBlobOversized?` where applicable) — set by the origin
device on a permanent `413` (§7.3) and **synced inside the sealed record**
(the server sees only ciphertext; `shared-types` wire-row shapes gain the
optional fields). The sentinel is the durable truth for "this blob will
never exist server-side" (Laura hard / Larissa L-4): pullers suppress
fetch/retry for it, and epoch recovery skips re-enqueueing it.

- **Seal-side** (`blob-transform.ts`, running inside WS-C's §10 strip
  step): ensure every present `Blob` has a ref (mint id on first push),
  strip the `Blob` fields, attach refs + sentinels. The wire row never
  carries bytes.
- **Apply-side:** store the pulled row with its refs; bytes arrive per the
  fetch strategy (§6). A row whose ref is present but bytes are absent is
  the **placeholder state** — first-class, not an error; with the oversize
  sentinel it is a **terminal** placeholder (§10 copy), not a pending one.
- `BlobRef.bytes` (ciphertext size) drives progress display AND the §6
  download size gate.
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
- Avatar replace / re-imaged rows (Class 2 via `mutateSynced`):
  `blob-put` (new id) + record upsert; the **`blob-delete` of the replaced
  id is enqueued only after the record upsert is ack'd `ok` (not
  `conflict`)** — a conflicted ref may not have won LWW, and deleting the
  old blob under a winning old ref destroys a live object (Larissa M-2).
  The drain performs this deferral; the call site enqueues intent.
- User-reachable deletes and cascades (chat → attachments + artefacts;
  persona → avatar): record tombstones + `blob-delete`s per blob-spec §11.
- Coalescing: `blob-put` + `blob-delete` for the same never-pushed blobId
  cancels to nothing (mirror of WS-C's create+delete rule).
- **Pending `blob-put`s are dropped transactionally with the record's
  pulled-tombstone trash routing** (WS-C §7.3's single transaction). Drain
  phase 1 therefore reads bytes from **live rows only** — there is no
  trash-read upload path (Larissa L-1; trash restore re-uploads under
  fresh ids anyway, §8).

**Drain phase order (blob spec §12, load-bearing):**

1. **`blob-put`s first** — a puller must never resolve a committed record
   to a blob the server has not seen. Bytes nowhere locally → drop the
   entry with a diagnostic.
2. Record upserts, then record tombstones (WS-C's existing phases).
3. **`blob-delete`s last** — an orphaned blob is harmless (quota-charged
   until deleted); a dangling reference is a user-visible hole. Replaced-id
   deletes additionally wait for their record's `ok` ack (above).

A failed `blob-put` (network, quota) blocks **its record's upsert** in the
same cycle (ordering) but never the rest of the queue.

## 6. Fetch strategy (decision 1)

- **Eager, at apply:** `thumbBlobRef` (artefacts) and `personaAvatars`
  refs enter a fetch queue — concurrency 3, retry within the §7.1 budget.
  **View priority (Laura):** refs belonging to the currently-mounted
  surface jump the queue on view, so the chat in focus pictures itself
  first; otherwise FIFO.
- **Lazy, on view:** artefact originals and attachment images fetch when
  their surface first renders the row. Placeholder (blurred thumb where
  one exists, neutral frame otherwise) + a progress affordance driven by
  `BlobRef.bytes`.
- **The lightbox is dismissable at any time** (back / tap-out) during a
  fetch; dismissing detaches the fetch, which completes in the background
  onto the Dexie row, so the next open hydrates instantly; a mid-fetch
  failure degrades to the quiet-retry affordance (Laura — the ring must
  never trap the user).
- **Download size gate (Larissa M-3):** `BlobRef.bytes` rides inside the
  MK-authenticated record ciphertext — it is the one size the server
  cannot forge. `blob-transport.ts` counts the received stream and
  **aborts when it exceeds the ref's `bytes`** (exact match expected —
  sealed body size is deterministic); the response's `Content-Length` is
  advisory only. A mismatch is a corrupt body → §7.2, under its cap.
- Downloaded bytes are written onto the row's `Blob` field in Dexie (the
  local store IS the cache; no second cache layer), with the usual TanStack
  invalidation. GET → `openBlob` → GCM/AAD authenticates content against
  `(MK, blobId)`; an open failure is a corrupt body (§7.2), never a
  partial write to the row.
- **Hydration is visible, not lied about (Laura):** while the eager queue
  drains after a fresh link or bulk pull, the status line shows a calm
  sub-state — "Fetching images…" — and **"Synced" is gated until the eager
  queue is empty**. (Progressive thumb pop-in remains; the line just stops
  claiming completion first.)

## 7. Inert resolution and repair

### 7.1 Dangling refs (GET `404`) — bounded retries (Larissa M-4)

Placeholder + scheduled retry with exponential backoff **capped at hours**,
drawn from a **per-cycle retry budget shared across all dangling refs**
(default 16 GETs/cycle); after N consecutive failures (default 8) the ref
enters a **rests-until-next-session** terminal state whose placeholder
keeps the manual retry affordance (§10) as the escape hatch. If this device
holds the bytes → **repair PUT** (deterministic re-seal, idempotent: `201`
row-lost / `200` object-present both heal). Refs carrying the oversize
sentinel never enter retry at all (§4).

### 7.2 Corrupt/foreign stored state — fresh-id repair under a cap (Larissa M-1)

Triggers: repair-PUT `409 blob_exists` (stored hash cannot match an honest
deterministic re-seal) or GET-ok-but-`openBlob`-fails. Both are
**server-controlled signals and cryptographic evidence of server/storage
misbehaviour** — each occurrence raises the WS-C tamper/attention
vocabulary, not silent churn. When this device holds the bytes, repair =
fresh `blobId` + PUT + Class-2 record update carrying the new ref +
(deferred, §5) delete of the old id. **Cap:** one fresh-id attempt per
blobId, then exponential backoff within a per-cycle repair budget
(default 2); after 3 failed generations for one logical blob → permanent
placeholder + persistent attention state (the WS-C §8 "behaving
inconsistently" pattern). This bounds the malicious-server churn loop
(multi-MiB uploads + rev churn + delete-rate burn) that an uncapped rule
invites. Without local bytes: placeholder + diagnostic. A corrupt blob
never fails or mutates the referencing record's application — the capped,
tamper-flagged Class-2 ref update is the **named exception** to WS-C
§12.3's no-server-induced-mutation posture, and this sentence is its
honest statement (Larissa M-1 wording reconciliation).

**Proactive heal (Larissa M-2b):** on pulling a record whose ref points at
a blob this device holds bytes for **and whose id this device previously
deleted or replaced**, schedule a repair-PUT (idempotent under
deterministic sealing). This closes the LWW-vs-delete race window for the
byte-holding device; the residual — no device holds the bytes — is stated:
the ref rests in §7.1's terminal state.

### 7.3 The rest of the matrix

| Case | Behaviour |
|---|---|
| GET `501 blobs_disabled` | placeholder, retry suppressed — disabled is not missing; re-probe only when `/api/v1/config` changes |
| PUT `413 blob_too_large` | **permanent per-blob failure**: set the §4 oversize sentinel on the row (a Class-2 record update, so every device learns it durably), mark the outbox entry failed with catalogue copy naming the operator's limit; the record syncs without server-side bytes — remote devices render the terminal placeholder (§10), never a retry loop (Laura hard) |
| PUT `quota_exceeded` | attention state with `{usedBytes, quotaBytes}` copy (§9) + the per-item marker (§10); entry retries after space is freed |

## 8. Trash and epoch interplay

- A pulled tombstone routes the row to WS-C's trash **with its local blob
  bytes in the trash row** — images stay restorable through the 30-day
  window. **Byte-pressure valve (Larissa L-3):** blob bytes in trash are
  capped (default 256 MiB); above it, the oldest trash rows' *bytes* are
  dropped (the rows themselves are retained, so a future restore can
  re-fetch by ref if the server still holds the blob). Restore (dev-tools
  in v1) mints a new uuid **and new blobIds** and re-uploads. WS-C's
  trash-anchored terminality guard (H-1) applies unchanged.
- **Epoch recovery extends WS-C §8:** after the record recovery, diff local
  refs against `GET /api/v1/sync/blobs` (the inventory) and re-PUT what the
  server lost — plain idempotent re-PUTs, skipping oversize-sentinel refs.
  Runs **inside the same rate-limited recovery cycle** — WS-C M-4's
  flap-stop is what bounds a lying-inventory server to ~2 full re-upload
  rounds before the engine halts with attention (Larissa L-5, stated).
  Above a per-recovery re-upload threshold (default 512 MiB) the attention
  state **asks before uploading**.
- Inventory ids this client does not reference are ignored (orphan sweep
  deferred — server spec §19). Cross-flag for that future sweep, registered
  in [[insights/future-feature-couplings]]: **it must never delete
  unreferenced inventory ids before full pull convergence**, or a
  lying/slow server turns the sweep into self-harm (Larissa I-2).

## 9. Quota display and copy (decision 2)

- The WS-C status line gains a second row on the account page: "X of Y
  storage used" from the inventory endpoint (fetched on page mount and
  after quota errors — not polled). **Display-only, pinned (Larissa I-3):**
  no engine decision ever rides on the server-reported numbers — a lying
  "full" must not become a write-suppression lever; uploads are attempted
  and the server's per-request verdict governs.
- Copy joins WS-C's `sync/copy.ts` catalogue: `blob_too_large` origin copy
  ("This image is larger than your server accepts (limit: N MB). It stays
  on this device."), the remote terminal-placeholder copy ("This image was
  too large for the server — it lives on the device that created it."),
  placeholder/progress/fetching-images strings, and the quota copy —
  which names **the linked instance** ("your server at <host>", the
  identity the server-linking page already shows) instead of an
  unreachable abstract "operator" (Laura).

## 10. UX surfaces (Laura — spec-pass folded)

- Placeholder states: blurred thumbnail where a thumb exists, calm neutral
  frame with file-type glyph otherwise; progress ring driven by
  `BlobRef.bytes`; a *pending* failed fetch shows a quiet retry
  affordance; a *terminal* state (oversize sentinel, §7.1 rest state)
  shows its explanatory copy instead — the two are visually and
  behaviourally distinct, never a broken-image glyph, never a retry nag
  on something unrecoverable.
- **Per-item sync markers on the origin device (Laura hard/soft):** an
  artefact/attachment whose blob permanently failed (413) or is waiting on
  quota carries a small inspectable marker at the item in the chat/Treasury
  ("not synced — too large" / "not synced — storage full"), because the
  user who created the image lives in the chat, not on the account page.
  Calm pill, disabled-over-hidden discipline, no toasts.
- The lazy path must never block the chat stream: messages render with
  placeholders and hydrate in place; the lightbox exit rule is §6's.
- Quota line copy is informational, not alarming; it names the freeing
  action and the linked instance.
- No new screens, no settings surface (decision 1).

## 11. Security invariants (Larissa) `[L]`

1. **Bytes on the wire are `sealBlob` output only**; the plaintext hash
   never leaves the device (pin-verified against `sync-blob/seal.ts`: it
   exists only inside the seal computation and is not exported — the
   engine must never add a content fingerprint header, log line, or dedup
   key).
2. **`x-ciphertext-hash` is computed locally** from the sealed body on
   every PUT path — initial, repair, epoch re-upload — never copied from a
   server response.
3. **blobIds are `mintBlobId()` random, never content-derived** (no
   equality-oracle surface), and **one blobId is referenced by exactly one
   (row, field), ever** (Larissa I-1) — `blob-delete`-old depends on this;
   any future row-copy/forward feature must mint fresh ids, never share
   refs.
4. Download integrity rides GCM+AAD (`openBlob` binds MK + blobId) plus
   the §6 size gate from the authenticated `BlobRef.bytes`: a swapped,
   corrupted, or oversized body fails closed into §7's capped repair paths
   without touching the referencing record (beyond §7.2's named, capped,
   tamper-flagged ref-update exception).
5. Ordering discipline (§5) is an integrity property, including the
   deferred replaced-id delete (never delete under a possibly-losing ref).
6. Blob HTTP uses the same bearer + refresh discipline as the record
   channel; no tokens in URLs; inventory/quota responses are display-only
   and carry no plaintext metadata to log.
7. **`BlobRef` validation before use (Larissa L-2):** `bytes` non-negative
   with a sane ceiling before it drives progress or the size gate;
   `blobId` exactly 22 base64url chars **before** URL interpolation.
   Defence-in-depth against buggy/replayed rows.

## 12. Out of scope

- Trash restore UI (WS-C follow-up owns it; blob bytes in trash make it
  richer later).
- Wifi/metered heuristics, prefetch bounds, storage-pressure eviction
  beyond §8's trash valve (v1 keeps fetched bytes — matches today's
  fully-local behaviour).
- The orphaned-blob sweep (server spec §19; the §8 cross-flag is
  registered for it).
- Uplevelling blob re-upload (rides the uplevelling workstream).
- Any server change.

## 13. Testing

- `blob-transform.ts`: seal-side strip/ref/sentinel attachment and
  apply-side passthrough for all field pairs; avatar `blobRef: null`
  removal (never tombstone); `BlobRef` validation rejects malformed
  ids/sizes.
- Drain ordering: put-before-record, tombstone-before-delete, **replaced-id
  delete deferred until `ok` ack and suppressed on `conflict`** (M-2),
  failed put blocks own record only, put+delete coalesce, tombstone drops
  pending puts transactionally (L-1).
- Repair matrix: 404-with-local-bytes → re-PUT; 409 → tamper signal +
  fresh-id under the cap; cap exhaustion → permanent placeholder +
  attention; open-fail both branches; 501 suppression; **413 → sentinel
  set, remote device suppresses retry and renders terminal copy**;
  proactive heal on pulled-ref-with-local-bytes-after-own-delete.
- Fetch: eager queue concurrency + view-priority boost, lazy trigger,
  dismissable lightbox detach, placeholder → hydrate, retry budget +
  rest-until-next-session, **size-gate abort on over-ref-size stream**,
  corrupt body → capped repair without record mutation.
- Status: "Fetching images…" gates "Synced" until the eager queue drains.
- Trash: bytes retained; byte-cap drops oldest bytes but keeps rows;
  epoch recovery inventory diff + re-PUT, sentinel skip, threshold-ask,
  containment inside the recovery rate limit.
- Full battery: `pnpm typecheck --force` (14/14), full user-client vitest
  (8-failure baseline rule), `pnpm build`, Biome.

## 14. Manual verification (Chris, dev stack + MinIO, two browsers)

1. Dev stack up including MinIO; devices A and B linked (WS-C's setup).
2. Generate an image artefact on A → B shows the thumb eagerly (status
   line passes through "Fetching images…" before "Synced"); opening the
   lightbox on B fetches the original with a progress ring; tap-out
   mid-fetch works and the image is hydrated on reopen.
3. Set a persona avatar on A → it appears on B without interaction.
   Remove it on A → B falls back to the monogram (no tombstone in
   DevTools).
4. Send an image attachment on A → B renders placeholder, then hydrates.
5. Delete the chat on A → B's rows move to trash **with bytes** (DevTools);
   MinIO objects disappear after the drain (delete phase).
6. Delete the S3 object for a blob by hand (MinIO console) → B shows the
   placeholder + retry; A (holding bytes) repairs it on its next cycle; B
   then hydrates.
7. Corrupt a stored object by hand (upload garbage under the same key via
   MinIO console) → the next GET raises the tamper attention state and the
   byte-holding device repairs under a fresh id; the old id is deleted
   only after the record ack.
8. Upload an image larger than `MAX_BLOB_BYTES` → A shows the too-large
   copy AND the per-item "not synced" marker on the artefact; B shows the
   terminal placeholder with its copy and never retries (network tab).
9. Fill the quota (small dev quota) → the attention state shows X of Y
   naming the instance host; the item carries the "storage full" marker;
   deleting artefacts frees space and the retry drains.
