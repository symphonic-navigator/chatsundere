// SPDX-License-Identifier: AGPL-3.0-only
import { useSessionStore } from '@chatsundere/ui-shared';
import type { SyncRowMeta } from '../boot/client-data-db.js';
import { getClientDataDb } from '../boot/client-data-db.js';
import { hashRow } from './content-hash.js';
import { enqueueSync } from './enqueue.js';
import { isSyncAvailable } from './gate.js';
import { isEnginePaused } from './recovery.js';
import { getLinkGeneration, getSyncState } from './watermark.js';
import { drainOutbox, readLocalRow } from './worker.js';

/**
 * Corpus-wide reconnect reconciliation (Task B9, Workstream B Finding #7). The
 * `deferWhenOffline` write path (`enqueue.ts`'s `mutateSynced`) commits a local
 * mutation with NO `syncOutbox` entry when a Class-2 write is offline-deferred
 * — background jobs (title generation, memory extraction, vision description)
 * use it so an offline device never loses their write. `backfill.ts` only ever
 * picks up rows that have NEVER synced (no `syncRows` CAS base). A row that HAS
 * synced before, whose content a background job then changed while
 * offline-deferred, therefore never re-enters the outbox on its own — it only
 * converges if the SAME key happens to be edited again through a normal
 * (enqueuing) write path. This pass closes that gap corpus-wide: on a coarse
 * interval, it walks every already-synced row, compares its CURRENT content
 * against the fingerprint recorded at its last observation, and enqueues an
 * `upsert` for any row whose content has drifted.
 *
 * DESIGN NOTE — why this does NOT re-seal and compare `ciphertextHash` (the
 * naive approach): `sealRecord` draws a FRESH random AES-GCM nonce on every
 * call (`packages/crypto/src/sync-envelope/seal.ts`), so re-sealing an
 * UNCHANGED row produces a DIFFERENT ciphertext — and therefore a different
 * `ciphertextHash` — every single time. Comparing against the stored
 * (nonce-dependent) `syncRows.ciphertextHash` would flag every already-synced
 * row as "divergent" on every pass: exactly the false churn this task must
 * avoid. Instead this module hashes the DETERMINISTIC pre-seal plaintext (the
 * same `stripForSeal` transform the real seal path uses, JSON-encoded,
 * SHA-256'd — see `content-hash.ts`'s `hashRow`, the shared implementation)
 * and compares it against a local-only baseline (`SyncRowMeta.localContentHash`),
 * NEVER sent to the server (a hash of plaintext is content-correlatable across
 * records in a way a hash of already-public ciphertext bytes is not, so it
 * must stay off the wire). This is also far CHEAPER than a real seal: no DEK
 * derivation, no AES-GCM — a structural strip, a JSON encode, and one
 * SHA-256 digest per row.
 *
 * BASELINE MAINTENANCE (follow-up to the initial B9 landing): a bare
 * `db.syncRows.put(meta)` whole-record replace — the shape both a normal
 * push-ack (`worker.ts`'s `applyOk`) and a normal pull-apply (`apply.ts`) used
 * to write — carries no `localContentHash`, so it silently WIPED the baseline
 * back to `undefined` on every ordinary sync. The very next reconcile pass
 * would then treat the row as "first observation" (see BOOTSTRAP below) and
 * re-establish a fresh baseline WITHOUT enqueuing — so a `deferWhenOffline`
 * divergence landing in the window between a row's last normal sync and the
 * next reconcile was silently absorbed as the new baseline and never pushed.
 * Both convergence points now stamp `localContentHash` themselves (to the
 * content that just landed, matching what THIS module would hash on its next
 * pass), so the baseline stays "last known-synced content" continuously and
 * this module's own bootstrap branch only ever fires for a genuinely legacy
 * row (one that predates this scheme entirely).
 *
 * BOOTSTRAP: a `syncRows` entry with no `localContentHash` yet (every row that
 * predates this field, i.e. the entire existing corpus on the first pass after
 * this ships) has its baseline established WITHOUT enqueuing. There is no
 * historical reference point to compare against; treating "unknown" as
 * "divergent" would push the ENTIRE existing corpus once on the very first
 * pass on every already-linked device — itself a false-churn violation, just a
 * one-time one. Any row that ACTUALLY diverges AFTER its baseline is
 * established is guaranteed to be caught on a later pass. Known limitation:
 * a row that had ALREADY diverged before this feature shipped is not
 * retroactively caught by that first pass (its current, already-diverged
 * content becomes the baseline) — see the task report.
 */

/**
 * Coarse throttle (spec intent: "not on every trigger"): at most one full
 * corpus scan per this window, regardless of how many `runSyncCycle`
 * invocations happen in between (boot, unlock, foreground, connectivity
 * regain, or the 3-second debounced Class-1 kick can all fire far more often
 * than this). Deliberately gated on ELAPSED TIME alone rather than a dedicated
 * connectivity-regain subscription: a real offline stretch worth reconciling
 * after almost always exceeds this window, so the very next cycle post-reconnect
 * — whichever trigger fires it — finds the gate open and reconciles promptly,
 * without extra cross-module wiring beyond what `runSyncCycle` already has.
 */
export const RECONCILE_INTERVAL_MS = 30 * 60 * 1000;

/** Rows hashed per chunk before yielding to the event loop and re-checking the
 *  abort guards — keeps a large corpus from blocking the main thread (and the
 *  sync Web Lock this pass runs under) in one synchronous burst. */
export const RECONCILE_CHUNK = 200;

/** Guards re-checked between chunks (mirrors `backfill.ts`'s `canContinue`). */
function canContinueReconcile(): boolean {
  return useSessionStore.getState().mk !== null && isSyncAvailable() && !isEnginePaused();
}

/** A macrotask yield — relieves the main thread between chunks (§ batching). */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Run the corpus-wide reconciliation pass if the coarse interval has elapsed
 * (Task B9). No-ops instantly — one cheap `syncState` read — the overwhelming
 * majority of the time it is called, so `runSyncCycle` calling it on every
 * cycle is safe. When due: walks every `syncRows` entry NOT currently in the
 * outbox (an in-flight or terminal entry is already accounted for by the
 * ordinary drain), chunked with a yield + abort re-check between chunks, and
 * enqueues an `upsert` (via the SAME `enqueueSync` mechanism a normal edit
 * uses, so the existing drain pushes it) for any row whose current content
 * hash differs from its stored baseline. Runs entirely under the caller's sync
 * Web Lock (it is invoked from inside `runSyncCycle`'s single-flight section,
 * exactly like backfill) — never call this outside that lock.
 *
 * A per-row failure (a hash/encode throw on some unanticipated row shape) is a
 * backstop-caught skip, not a whole-pass abort (mirrors the pull loop's
 * per-record backstop, worker.ts) — one poison row must never wedge every
 * other row's convergence, nor the cycle itself. An abort from the coarse
 * guards (offline/locked/relink mid-scan) does NOT stamp `lastReconcileAt`, so
 * the next eligible cycle retries the FULL scan rather than silently losing
 * the unreached tail until the interval elapses again.
 */
export async function runReconciliationIfDue(): Promise<void> {
  if (!canContinueReconcile()) return;
  const state = await getSyncState();
  if (Date.now() - (state.lastReconcileAt ?? 0) < RECONCILE_INTERVAL_MS) return;

  const db = getClientDataDb();
  const generation = await getLinkGeneration();
  const metas = await db.syncRows.toArray();
  const outboxKeys = new Set(
    (await db.syncOutbox.toArray()).map((r) => `${r.collection}:${r.key}`),
  );

  let enqueuedAny = false;
  let processed = 0;
  for (const meta of metas) {
    if (!outboxKeys.has(`${meta.collection}:${meta.key}`)) {
      try {
        const row = await readLocalRow(meta.collection, meta.key);
        if (row !== undefined && row !== null) {
          const currentHash = await hashRow(meta.collection, row);
          if (meta.localContentHash === undefined) {
            // First observation under this scheme (§ BOOTSTRAP above): record
            // the baseline only — no historical reference point to diverge from.
            await db.syncRows.update([meta.collection, meta.key], {
              localContentHash: currentHash,
            });
          } else if (currentHash !== meta.localContentHash) {
            await db.transaction('rw', [db.syncOutbox, db.syncRows], async (tx) => {
              enqueueSync(tx, meta.collection, meta.key, 'upsert');
              await tx
                .table<SyncRowMeta, [string, string]>('syncRows')
                .update([meta.collection, meta.key], { localContentHash: currentHash });
            });
            enqueuedAny = true;
          }
        }
      } catch (err) {
        console.error('[sync] reconciliation: unexpected throw hashing a row — skipped', {
          collection: meta.collection,
          key: meta.key,
          err,
        });
      }
    }

    processed += 1;
    if (processed % RECONCILE_CHUNK === 0) {
      await yieldToEventLoop();
      if (!canContinueReconcile() || (await getLinkGeneration()) !== generation) return;
    }
  }

  if (!canContinueReconcile() || (await getLinkGeneration()) !== generation) return;
  await db.syncState.update('state', { lastReconcileAt: Date.now() });

  if (enqueuedAny) {
    try {
      await drainOutbox();
    } catch {
      // Not this pass's problem — the enqueued entries stay queued and the
      // ordinary drain/backoff machinery (next cycle, or the immediate-drain
      // write-through) retries them.
    }
  }
}
