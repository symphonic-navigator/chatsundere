// SPDX-License-Identifier: AGPL-3.0-only
import type { SyncCollection } from '@chatsundere/shared-types';
import { useAccountLinkStore, useSessionStore } from '@chatsundere/ui-shared';
import type { SyncOutboxRow } from '../boot/client-data-db.js';
import { getClientDataDb } from '../boot/client-data-db.js';
import { blobFieldsOf, mintBlobRefFor } from './blob-transform.js';
import { isSyncAvailable } from './gate.js';
import { isEnginePaused } from './recovery.js';
import { syncKeyOfRow } from './sync-keys.js';
import { getSyncState } from './watermark.js';
import { drainOutbox } from './worker.js';

/**
 * The late-link backfill pump (spec §3.3–§3.4). When a local-only user links an
 * account, the vault they already built has no CAS bases and never entered the
 * outbox — the live drain only sees NEW edits. The pump walks that pre-existing
 * corpus once, in dependency order, enqueuing an `upsert` (plus any `blob-put`s)
 * for every row the server has not yet seen and draining chunk by chunk until the
 * whole vault has climbed up.
 *
 * Design points that are load-bearing:
 *  - **One collection per chunk, ≤ {@link BACKFILL_CHUNK} keys.** The server
 *    rejects an over-large push wholesale (L-2), so the chunk is bounded to the
 *    push ceiling and never mixes collections.
 *  - **Structural parents first, vectors last** ({@link BACKFILL_ORDER}). A child
 *    whose parent has not synced yet is harmless (records are independent CAS
 *    cells), but pushing parents first keeps a mid-pump crash's partial state
 *    coherent for a puller.
 *  - **Candidates are un-synced only** (§3.4): a local row with NO `syncRows`
 *    CAS base AND NO `syncOutbox` entry of any op (a pending entry is already in
 *    flight; a terminal one is doomed and must never be re-enqueued — L-6), and
 *    for `mindspaces` never a built-in (deterministically seeded on every
 *    device — syncing them would be redundant, §12.5).
 *  - **A one-off total** (§3.7/U-8): the total is snapshotted on the first run
 *    and never recomputed, so rows the user adds mid-backfill do not inflate the
 *    progress denominator — the bar advances honestly toward a stable target.
 *  - **Abort-safe and idempotent** (§3.4): a drain throw aborts the pump; the
 *    flag survives and the next cycle resumes. Guards are re-checked between
 *    chunks so a lock/unlink/pause stops the pump promptly.
 *
 * Registered nowhere itself — the worker cycle calls {@link runBackfillIfPending}
 * after its drain, and the global status line renders the counters.
 */

const STATE_ID = 'state' as const;

/** ≤ the server's MAX_PUSH_RECORDS — a bigger chunk is rejected wholesale (L-2). */
export const BACKFILL_CHUNK = 100;

/** §3.3 — structural parents before bulk children; vectors last. */
export const BACKFILL_ORDER: readonly SyncCollection[] = [
  'settings',
  'providers',
  'mcpServers',
  'mindspaces',
  'personas',
  'personaAvatars',
  'seedTemplates',
  'libraries',
  'documents',
  'chats',
  'artefacts',
  'attachments',
  'messages',
  'pills',
  'memoryJournal',
  'memoryBody',
  'compactionCheckpoints',
  'vectors',
];

/** The three blob-bearing collections whose bytes ride the separate channel (§4). */
const BLOB_COLLECTIONS: ReadonlySet<SyncCollection> = new Set<SyncCollection>([
  'personaAvatars',
  'artefacts',
  'attachments',
]);

// ===== Injectable seams (production defaults; tests override) =====

type DrainFn = () => Promise<unknown>;
let drainOverride: DrainFn | null = null;
let vectorKeysOverride: (() => Promise<string[]>) | null = null;

/** Test seam: intercept the per-chunk drain (defaults to the real `drainOutbox`). */
export function _setBackfillDrain(fn: DrainFn | null): void {
  drainOverride = fn;
}
/**
 * Test seam: supply the `vectors` collection's sync keys directly, so a backfill
 * test never has to boot the embeddings engine / knowledge vector database.
 */
export function _setVectorKeysSource(fn: (() => Promise<string[]>) | null): void {
  vectorKeysOverride = fn;
}
/** Test seam: restore every override to its production default. */
export function _resetBackfillForTests(): void {
  drainOverride = null;
  vectorKeysOverride = null;
}

// ===== Candidate enumeration =====

/**
 * Every local sync key for a collection (§3.6). `settings` is the singleton (key
 * `'1'`); `vectors` live in the separate knowledge database (lazily imported so
 * the embeddings engine never loads on the far commoner non-vector path);
 * built-in mindspaces are excluded (deterministically seeded on every device —
 * syncing them would be redundant, §12.5). Everything else derives its key
 * from the row via `syncKeyOfRow`.
 */
async function listLocalKeys(collection: SyncCollection): Promise<string[]> {
  const db = getClientDataDb();
  if (collection === 'settings') return (await db.settings.get(1)) ? ['1'] : [];
  if (collection === 'vectors') {
    if (vectorKeysOverride) return vectorKeysOverride();
    const { listKnowledgeVectorSyncKeys } = await import('../boot/knowledge-vectors-db.js');
    return listKnowledgeVectorSyncKeys();
  }
  const rows = await db.table(collection).toArray();
  return rows
    .filter(
      (row) => !(collection === 'mindspaces' && (row as { builtIn?: boolean }).builtIn === true),
    )
    .map((row) => syncKeyOfRow(collection, row));
}

/**
 * The un-synced candidate keys for a collection (§3.4): a local key with neither
 * a `syncRows` CAS base nor ANY `syncOutbox` entry (pending or terminal — either
 * means "already accounted for", so the pump never double-enqueues or revives a
 * doomed record).
 */
async function listUnsyncedKeys(collection: SyncCollection): Promise<string[]> {
  const db = getClientDataDb();
  const keys = await listLocalKeys(collection);
  if (keys.length === 0) return [];
  const metas = await db.syncRows.bulkGet(keys.map((k) => [collection, k] as [string, string]));
  const outboxKeys = new Set(
    (await db.syncOutbox.toArray()).filter((r) => r.collection === collection).map((r) => r.key),
  );
  return keys.filter((key, i) => metas[i] === undefined && !outboxKeys.has(key));
}

/** The live non-terminal outbox depth — the pump's completion gate (§3.4). */
async function nonTerminalOutboxCount(): Promise<number> {
  const rows = await getClientDataDb().syncOutbox.toArray();
  return rows.filter((r) => r.terminal !== true).length;
}

/** Guards re-checked between chunks (§3.3): unlocked, sync available, not paused. */
function canContinue(): boolean {
  return useSessionStore.getState().mk !== null && isSyncAvailable() && !isEnginePaused();
}

/**
 * Arm the backfill flag on an already-stranded linked device (the durable
 * rescue, Unit 1b): a device that linked BEFORE this pump existed (or whose
 * boot never reached {@link runBackfillIfPending} for any other reason) can
 * hold a pre-existing corpus that never entered `syncRows`/`syncOutbox` and
 * would otherwise never backfill. Self-guards on the same preconditions as
 * the pump (unlocked, linked) plus "not already armed" — cheap no-ops in the
 * overwhelmingly common already-armed/local-only/fully-synced cases — then
 * walks {@link BACKFILL_ORDER} and arms on the first collection holding an
 * un-synced key. `backfillTotal`/`backfillDone` are left `null` so the pump's
 * own one-off snapshot (§3.7) fires on its next run, exactly as if the flag
 * had been set at link time.
 */
export async function armBackfillIfCorpusUnsynced(): Promise<void> {
  if (useSessionStore.getState().mk === null) return;
  if (useAccountLinkStore.getState().linkStatus !== 'linked') return;
  const state = await getSyncState();
  if (state.backfillPending === true) return;
  for (const collection of BACKFILL_ORDER) {
    if ((await listUnsyncedKeys(collection)).length > 0) {
      await getClientDataDb().syncState.update(STATE_ID, {
        backfillPending: true,
        backfillTotal: null,
        backfillDone: null,
      });
      return;
    }
  }
}

// ===== The pump =====

/**
 * Pump the late-link backfill to completion, or return early (§3.3–§3.4). A
 * no-op unless `backfillPending` is set and every guard holds. On the first run
 * it snapshots the un-synced total; thereafter it enqueues and drains one chunk
 * at a time, resuming across cycles until the vault has fully synced, then clears
 * the flag and counters. A drain throw aborts the pump with the flag intact.
 */
export async function runBackfillIfPending(): Promise<void> {
  const db = getClientDataDb();
  let state = await getSyncState();
  if (state.backfillPending !== true) return;
  if (!canContinue()) return;

  // §3.7 — snapshot the total ONCE. Rows added later are not counted, so the
  // denominator stays stable while the numerator climbs (U-8).
  if (state.backfillTotal === null || state.backfillTotal === undefined) {
    let total = 0;
    for (const collection of BACKFILL_ORDER) total += (await listUnsyncedKeys(collection)).length;
    await db.syncState.update(STATE_ID, { backfillTotal: total, backfillDone: 0 });
    state = await getSyncState();
  }

  const drain = drainOverride ?? drainOutbox;
  let done = state.backfillDone ?? 0;

  for (const collection of BACKFILL_ORDER) {
    for (;;) {
      if (!canContinue()) return;
      const chunk = (await listUnsyncedKeys(collection)).slice(0, BACKFILL_CHUNK);
      if (chunk.length === 0) break;
      await enqueueChunk(collection, chunk);
      try {
        await drain();
      } catch {
        return; // abort — the flag survives, the next cycle resumes (§3.4)
      }
      done += chunk.length;
      await db.syncState.update(STATE_ID, { backfillDone: done });
    }
  }

  // Flush any residual non-terminal entries left by a prior aborted cycle: their
  // keys are excluded from candidate enumeration (§3.4), so only an explicit
  // drain can clear them. Bounded by a strict decrease in the outbox depth.
  for (;;) {
    if (!canContinue()) return;
    const remaining = await nonTerminalOutboxCount();
    if (remaining === 0) break;
    try {
      await drain();
    } catch {
      return;
    }
    if ((await nonTerminalOutboxCount()) >= remaining) break; // no progress — retry next cycle
  }

  // §3.4 — completion: no collection yields a candidate AND the outbox holds no
  // non-terminal entry. Terminal (doomed) entries never block completion.
  if ((await nonTerminalOutboxCount()) === 0) {
    await db.syncState.update(STATE_ID, {
      backfillPending: false,
      backfillTotal: null,
      backfillDone: null,
    });
  }
}

/**
 * Enqueue one chunk (§3.4): an `upsert` per key, plus — for the blob-bearing
 * collections — a `blob-put` for every blob field whose row holds local bytes and
 * is not the terminal oversize sentinel.
 *
 * A pre-link blob row carries its bytes but NO `blobRef` (write sites mint a ref
 * only once linked, `data/{artefacts,attachments,persona-avatars}.ts`). So the
 * pump MINTS the ref here, mirroring a linked write site: it persists the ref to
 * the local row (so the drain's phase-1 reader `readBlobBytesById` resolves the
 * bytes and the phase-2 re-seal reuses the same ref for PUT/record stability) and
 * queues the `blob-put`. Without this the record backfills carrying a fresh
 * server-side blobId that is NEVER uploaded → a dangling ref that every other
 * device resolves to "image unavailable". Mint-once is preserved by re-reading the
 * ref inside the transaction, so a concurrent Class-2 edit that already minted
 * wins. Non-blob collections take the short outbox-only transaction (and
 * `vectors` lives in a separate DB whose table this one does not carry, so it must
 * not enter the tx scope).
 */
async function enqueueChunk(collection: SyncCollection, keys: string[]): Promise<void> {
  const db = getClientDataDb();
  const now = Date.now();

  if (!BLOB_COLLECTIONS.has(collection)) {
    const entries = keys.map(
      (key): SyncOutboxRow => ({ collection, key, op: 'upsert', enqueuedAt: now }),
    );
    await db.transaction('rw', db.syncOutbox, async () => {
      await db.syncOutbox.bulkAdd(entries);
    });
    return;
  }

  await db.transaction('rw', db.syncOutbox, db.table(collection), async () => {
    const entries: SyncOutboxRow[] = [];
    for (const key of keys) {
      entries.push({ collection, key, op: 'upsert', enqueuedAt: now });
      const row = (await db.table(collection).get(key)) as Record<string, unknown> | undefined;
      if (!row) continue;
      for (const spec of blobFieldsOf(collection)) {
        if (row[spec.oversizedField] === true) continue; // server-terminal — never re-PUT (§4/§7.3)
        const bytes = row[spec.bytesField];
        if (!(bytes instanceof Blob) || bytes.size === 0) continue; // no local bytes to upload
        const existing = row[spec.refField] as { blobId?: string } | null | undefined;
        let blobId = existing?.blobId;
        if (!blobId) {
          const ref = mintBlobRefFor(bytes);
          blobId = ref.blobId;
          await db.table(collection).update(key, { [spec.refField]: ref });
        }
        entries.push({ collection, key, op: 'blob-put', blobId, enqueuedAt: now });
      }
    }
    await db.syncOutbox.bulkAdd(entries);
  });
}
