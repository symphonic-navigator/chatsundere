# WS-D Implementation Plan — Blob Client

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teach the WS-C sync engine the blob channel: `BlobRef` transforms for the three blob-bearing collections, ordered blob PUT/DELETE outbox ops, the bounded repair machinery, the eager/lazy fetch strategy, and the per-item sync markers.

**Architecture:** Four new modules under `apps/user-client/src/sync/` (`blob-transport`, `blob-transform`, `blob-fetch`, `blob-repair`) plus extensions to the WS-C worker/apply/copy and the three collections' write sites. Spec: `superpowers/specs/2026-07-02-ws-d-blob-client-design.md` (**v2** — Larissa M-1–M-4/L-1–L-5/I-1–I-3 and Laura 1-hard/5-soft folded; the spec is the contract, this plan is the sequence).

**Tech Stack:** TypeScript strict, Dexie, `@chatsundere/crypto` sync-blob (`mintBlobId`/`sealBlob`/`openBlob`), Vitest + fake-indexeddb, pnpm + Turborepo.

## Operating rules for the overnight worker (READ FIRST)

Binding; they override your defaults.

1. **STOP-guard.** All must hold, or STOP, change nothing, report:
   - `STATUS-TRANSITION.md` exists at the repo root;
   - `superpowers/specs/2026-07-02-ws-d-blob-client-design.md` exists and
     contains "Version: v2";
   - **WS-C landed:** `apps/user-client/src/sync/worker.ts`,
     `sync/apply.ts`, `sync/enqueue.ts`, `sync/copy.ts` all exist and
     `client-data-db.ts` contains `this.version(33)`;
   - `apps/user-client/src/sync/blob-transform.ts` does NOT exist.
2. **Branch + integration target.** Fresh branch cut from
   `full-backend-transition`; any PR targets **`full-backend-transition`,
   NEVER `master`**. Do not merge anything yourself.
3. **Language.** British English everywhere; no German in the repo.
4. **TDD per task, in plan order.** Failing test → exact failure → minimal
   implementation → pass → commit. Subagents: one per task; they never
   merge, push, or switch branches.
5. **Commits.** Imperative subject, prefix `D:`. Footer:
   `Co-Authored-By: Liz (Claude Code) <noreply@anthropic.com>`.
6. **Gates.** Per task as named; Task 10 runs the full battery:
   `pnpm typecheck --force` (14/14, 0 cached),
   `pnpm --filter @chatsundere/user-client test`,
   `pnpm --filter @chatsundere/shared-types test` (if present),
   `pnpm build`. Biome bans `!`; check touched files before committing.
7. **Known-green baseline:** 0 or exactly 8 user-client failures
   (Node-26 localStorage trio); anything else is yours.
8. **Audits are NOT yours.** Larissa re-audits `blob-transport.ts`/
   `blob-repair.ts`; Laura walks §10. Where plan and spec diverge, the
   spec wins — report the divergence.
9. **Scope guard.** `client-data-db.ts`: **interface-only additions**
   (the §4 ref/sentinel fields on the three row interfaces) — NO
   `version()` call, NO `stores()` change, v33 stays WS-C's. Never touch
   services, `packages/crypto`, `packages/llm-unified`. `packages/
   shared-types`: only the optional sentinel fields on the three wire-row
   shapes. No new dependencies.
10. **Zero-knowledge invariants (Larissa):** spec §11 verbatim — locally
    computed `x-ciphertext-hash` on every PUT path, random blobIds, the
    §6 size gate from the authenticated ref, capped repair with tamper
    signalling, one-blobId-one-reference. Not weakenable for green tests.

---

### Task 1: Wire-row sentinels + local row fields (spec §4)

**Files:** Modify `packages/shared-types/src/` blob wire-row shapes (add optional `blobOversized?: true` / `thumbBlobOversized?: true`); modify the three row interfaces in `apps/user-client/src/boot/client-data-db.ts` (add `blobRef?`/`thumbBlobRef?`/sentinels — interface only, rule 9); test that v33 opens unchanged (no verno bump).

- [ ] Failing type-level test / row round-trip test → implement → `D: Add BlobRef and oversize sentinel fields to blob-bearing rows`

### Task 2: blob-transport (spec §3, §6 gate, §11.2/.6/.7)

**Files:** Create `sync/blob-transport.ts` + tests (mocked fetch).

**Produces:**

```ts
export function validateBlobRef(ref: unknown): BlobRef;    // §11.7 — 22-char base64url id, sane non-negative bytes; throws
export async function putBlob(blobId: string, body: Uint8Array, hash: string): Promise<PutBlobResult>; // 201/200/409/413/quota discriminated union
export async function getBlob(ref: BlobRef): Promise<Uint8Array>; // streams, counts, ABORTS over ref.bytes (Content-Length advisory); 404/501 as typed errors
export async function deleteBlob(blobId: string): Promise<void>;
export async function listBlobs(): Promise<BlobInventory>;  // display-only consumer (§9)
```

All bearer + one 401-refresh-retry (mirror `apiFetch`'s discipline; binary bodies so it cannot reuse `apiFetch` directly). Hash is ALWAYS the caller-supplied local seal output — this module never reads a server hash.

- [ ] Failing tests: each verb happy path, 401-refresh-once, the size-gate abort (stream longer than `ref.bytes` → typed corrupt-body error), malformed-ref rejection before any fetch.
- [ ] Implement → pass → `D: Add the binary blob transport with the size gate`

### Task 3: blob-transform (spec §4)

**Files:** Create `sync/blob-transform.ts` + tests; hook into WS-C's strip step (`sync/strip.ts` calls it for the three collections).

**Produces:** `stripBlobsForSeal(collection, row)` (mint ids for unminted `Blob`s via `mintBlobId`, attach refs/sentinels, drop `Blob` fields — returns `{ wireRow, newBlobs: Array<{blobId, bytes: Blob}> }` so the enqueue site can queue the puts) and `applyPulledBlobRow(collection, pulled, local)` (preserve local bytes when refs match; placeholder state otherwise; sentinel-aware).

- [ ] Failing tests: all four field pairs both directions; ref stability across re-seals; avatar `blobRef: null`; sentinel passthrough.
- [ ] Implement → pass → `D: Add the BlobRef transform for blob-bearing rows`

### Task 4: Outbox ops + drain phases (spec §5)

**Files:** Modify `sync/enqueue.ts` (op union + `blobId` field + blob enqueue helpers), `sync/worker.ts` (phase order: blob-puts → records → tombstones → blob-deletes; deferred replaced-id delete pending `ok` ack; failed put blocks own record only; put+delete coalesce; tombstone drops pending puts transactionally — extend WS-C's §7.3 transaction); tests.

- [ ] Failing tests: the full ordering matrix from spec §13's drain list, incl. the M-2 deferral (replaced-id delete suppressed on `conflict`) and L-1 (no trash-read uploads).
- [ ] Implement → pass → `D: Add blob ops and ordering to the sync drain`

### Task 5: Repair machinery (spec §7)

**Files:** Create `sync/blob-repair.ts` + tests.

**Produces:** the §7 matrix as a single `resolveBlobFailure(...)` entry point: 404-with-bytes → repair PUT; 409/open-fail → tamper attention + fresh-id repair under the caps (one attempt per blobId, per-cycle budget 2, 3 generations → permanent placeholder + persistent attention); 501 suppression keyed to config changes; 413 → sentinel Class-2 update + catalogue copy; quota → attention + per-item marker state; proactive heal (pulled ref + local bytes + own prior delete → schedule re-PUT).

- [ ] Failing tests: every row of the matrix, cap exhaustion, tamper-signal emission, sentinel durability (survives reload), heal trigger.
- [ ] Implement → pass → `D: Add bounded blob repair with tamper signalling`

### Task 6: Fetch strategy (spec §6) + collections join apply (spec §3)

**Files:** Create `sync/blob-fetch.ts`; modify `sync/apply.ts` (remove the three collections from the unhandled-skip; wire conflict keys — `artefacts`/`personaAvatars` LWW `updatedAt`, `attachments` engine-stamped; eager enqueue on apply); tests.

**Produces:** eager queue (concurrency 3, view-priority `boostSurface(refs)` API, §7.1 retry budget + rest state), `useBlobBytes(collection, key, field)` lazy resolver hook (placeholder → progress → hydrate; detach-on-unmount but fetch completes onto the row).

- [ ] Failing tests: queue concurrency/priority/budget/rest; lazy hydrate; apply-side eager enqueue for thumbs/avatars only; conflict keys per collection.
- [ ] Implement → pass → `D: Fetch blobs eagerly for thumbs and lazily on view`

### Task 7: Write-site sweep (spec §5 enqueue rules, blob spec §11 dispositions)

**Files:** The three collections' write paths: artefact creation (`lib/artefact-author.ts`, image-gen), artefact edits/delete + cascades (`data/`/Treasury paths), attachment send (`data/send-message.ts` — sync only once `messageId` set; pending compose stays device-local), attachment soft-delete/visionDescription sites, avatar set/replace/crop/remove (`data/personas.ts` + avatar editor), chat-delete cascade (attachments + artefacts), persona-delete cascade (avatar). Classify each hit in your report table (mirror the WS-C Task 11 discipline).

- [ ] Tests per family: creation enqueues put+record atomically; avatar remove is `blobRef: null` Class-2 (NEVER a tombstone — assert no tombstone op); cascades spread tombstones + deferred blob-deletes; pending attachments enqueue nothing.
- [ ] Full suite (rule 7) → `D: Enqueue blob writes across the three collections`

### Task 8: UX surfaces (spec §9, §10)

**Files:** Per-item sync marker component (chat/Treasury artefact + attachment surfaces; "not synced — too large" / "not synced — storage full"); terminal vs pending placeholder rendering; lightbox detach behaviour; "Fetching images…" status sub-state gating "Synced" (extend `SyncStatusLine` + WS-C's state); quota second line from `listBlobs()` on account-page mount; copy entries into `sync/copy.ts` (§9's exact strings, instance-host interpolation).

- [ ] Component tests: marker visibility per state, terminal placeholder never shows retry, pending placeholder does, status gating, quota line rendering.
- [ ] Full suite → `D: Add blob sync markers, placeholders, and quota display`

### Task 9: Adversarial scenarios (spec §13)

**Files:** `apps/user-client/tests/sync/blob-scenarios.test.ts` — scripted-server harness (WS-C Task 14's pattern): corrupt-body churn hits the repair cap and stops with attention; replace-vs-edit LWW race with deferred delete (old blob survives a `conflict`); oversized stream aborted at the gate; 413 sentinel round-trip (A sets → B suppresses); lying inventory bounded by the recovery rate limit + threshold-ask.

- [ ] Scenarios pass against Tasks 2–8 (fix bugs in the owning module, never weaken a scenario) → `D: Add adversarial blob integration scenarios`

### Task 10: Registers, battery, STATUS

- [ ] Append to `obsidian/insights/future-feature-couplings.md`: the orphan-sweep convergence cross-flag (spec §8, Larissa I-2); the one-blobId-one-reference invariant note for future duplicate/forward features (§11.3).
- [ ] Full battery (rule 6); record exact counts; rule-7 baseline statement.
- [ ] Update `STATUS-TRANSITION.md` §6/§7 (WS-D built-pending-audit).
- [ ] `D: Record WS-D blob client build in transition status [skip ci]`

## Final report checklist

Per-suite counts; typecheck cache line; the Task 7 classification table;
files touched beyond the plan (why); spec divergences (why); explicit
confirmation that §11's invariants have named passing tests.
