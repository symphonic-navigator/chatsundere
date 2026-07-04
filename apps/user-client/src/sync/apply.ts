// SPDX-License-Identifier: AGPL-3.0-only
import {
  computeBlindId,
  fromBase64Url,
  openRecord,
  sealBlob,
  toBase64Url,
} from '@chatsundere/crypto';
import type { MasterKey } from '@chatsundere/crypto';
import type { BlobRef, SyncCollection, SyncPulledRecord } from '@chatsundere/shared-types';
import { useSessionStore } from '@chatsundere/ui-shared';
import type { SyncRowMeta, TrashRow } from '../boot/client-data-db.js';
import { getClientDataDb } from '../boot/client-data-db.js';
import { QK } from '../data/queryKeys.js';
import { queryClient } from '../lib/queryClient.js';
import { enqueueEager } from './blob-fetch.js';
import { type BlobRepairDeps, maybeProactiveHeal } from './blob-repair.js';
import { applyPulledBlobRow, blobFieldsOf, isBlobCollection } from './blob-transform.js';
import { putBlob } from './blob-transport.js';
import { resolveConflict } from './resolution.js';
import { restoreLocalFields } from './strip.js';
import { extractKeyFor } from './sync-keys.js';
import { getSyncState, setAttention } from './watermark.js';

/**
 * Pull-side application (spec §7 — the security-critical path). `applyRecord`
 * turns ONE pulled wire record into a local effect under §7's exact ordering:
 * every step gates the next, and the load-bearing invariant is that a stale,
 * echoed, tampered, or tombstone-anchored record can never cause a destructive
 * local change. The watermark is NEVER advanced here — that is the pull loop's
 * per-page job (worker.ts), so a page that fails mid-apply loses nothing
 * retryable.
 *
 * SECURITY (spec §12) `[L]`:
 *  - §7.0 echo shortcut compares a LOCALLY-computed hash of the pulled
 *    ciphertext against our stored `syncRows.ciphertextHash` — NEVER the
 *    server-echoed `ciphertextHash` field (trusting it lets the server label
 *    arbitrary bytes as "your own echo").
 *  - §7.1 inert rejection: any open failure (GCM / codec / blind-id re-check)
 *    mutates nothing; a ciphertext-tampering server cannot use the client to
 *    destroy local data.
 *  - §7.4 H-1 trash-anchored terminality: an upsert for a key with a live
 *    pulled-tombstone trash entry is rejected inertly and raises the tamper
 *    alarm; the tombstone-then-resurrect rollback is structurally closed.
 */

/** The 30-day pulled-tombstone grace window (§7.3). */
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * The eager-fetch bytes fields (WS-D §6): thumbnails (`artefacts.thumbBlob`) and
 * avatars (`personaAvatars.blob`) enter the fetch queue at apply. Artefact
 * originals and attachment images are LAZY (fetched on view, Task 8's hook).
 */
const EAGER_BYTES_FIELDS: Partial<Record<SyncCollection, ReadonlySet<string>>> = {
  artefacts: new Set(['thumbBlob']),
  personaAvatars: new Set(['blob']),
};

/** §7.3a threshold: a calm notice once this many tombstones arrive in one cycle. */
const TOMBSTONE_THRESHOLD = 20;

/** §2.2 — max pulled tombstones APPLIED per cycle; the rest defer to the next cycle (lossless). */
export const TOMBSTONE_CYCLE_CAP = 200;

/** The typed outcome of applying one pulled record (never advances the watermark). */
export type ApplyOutcome =
  | { kind: 'echo' } // §7.0 — my own re-delivered write; rev adopted, no data change
  | { kind: 'stale' } // rev ≤ syncRows.rev — ignored
  | { kind: 'rejected' } // §7.1 inert rejection (open failed) or no MK
  | { kind: 'skipped' } // §7.2 unhandled collection (vectors — materialised elsewhere)
  | { kind: 'tombstoned' } // §7.3 — row routed to trash (or nothing local to move)
  | { kind: 'tamper' } // §7.4 H-1 — upsert onto a live tombstone anchor, rejected
  | { kind: 'suppressed' } // §7.4 L-3 — pending local delete wins
  | { kind: 'inserted' } // upsert, no local row → inserted
  | { kind: 'resolved'; winner: 'local' | 'pulled' }; // §7.5 conflict resolved

// ===== Module diagnostics / hooks =====

/** §7.1 diagnostic: inert-rejection tally, surfaced on the status line's detail (Task 13). */
let inertRejectionCount = 0;
/** §7.3a per-cycle pulled-tombstone tally; the pull loop resets it at loop start. */
let tombstoneCycleCount = 0;

/** §7.3 viewing breadcrumb: the UI (Task 13) registers this; a no-op until then. */
let onViewedRecordTombstoned: (collection: SyncCollection, key: string) => void = () => undefined;
/** §11.3 settings note: the toast surface (Task 13) registers this; a no-op until then. */
let onSettingsNote: (note: 'settings-applied' | 'settings-precedence') => void = () => undefined;

/** Read the inert-rejection diagnostic counter (§7.1). */
export function getInertRejectionCount(): number {
  return inertRejectionCount;
}

/** Reset the per-cycle tombstone tally; the pull loop calls this at loop start. */
export function resetTombstoneCounter(): void {
  tombstoneCycleCount = 0;
}

/**
 * §7.3a — retire a latched CALM tombstone notice at the END of a pull cycle that
 * did not itself re-cross the threshold. A one-off cross-device mass deletion
 * latches the `tombstone_threshold` notice via `setAttention`; nothing else ever
 * cleared it, so it stuck on the status line forever — on every device that
 * pulled the wave. The pull loop calls this once per completed cycle: while
 * deletions keep arriving (`tombstoneCycleCount` re-crosses the threshold) the
 * notice is left in place, preserving the Larissa M-2 visibility intent; only
 * once a cycle stays calm does the notice retire.
 *
 * DELIBERATELY scoped to `tombstone_threshold` only: a coexisting quota/tamper/
 * auth notice is never clobbered.
 */
export async function settleTombstoneNotice(): Promise<void> {
  if (tombstoneCycleCount >= TOMBSTONE_THRESHOLD) return; // re-raised this cycle — keep it
  const { attention } = await getSyncState();
  if (attention?.kind === 'tombstone_threshold') {
    await setAttention(null);
  }
}

/** Register the currently-viewing tombstone breadcrumb hook (§7.3, Task 13). */
export function setOnViewedRecordTombstoned(
  fn: (collection: SyncCollection, key: string) => void,
): void {
  onViewedRecordTombstoned = fn;
}

/** Register the settings-note toast hook (§11.3, Task 13). */
export function setSettingsNoteHook(
  fn: (note: 'settings-applied' | 'settings-precedence') => void,
): void {
  onSettingsNote = fn;
}

// ===== Blob apply-side hooks (WS-D §6/§7.2) =====

type EagerEnqueueFn = (
  collection: SyncCollection,
  key: string,
  bytesField: string,
  ref: BlobRef,
) => void;
type ProactiveHealFn = (blobId: string, bytes: Uint8Array, mk: MasterKey) => Promise<void>;

const defaultHealDeps: BlobRepairDeps = { sealBlob, putBlob };
const defaultHeal: ProactiveHealFn = async (blobId, bytes, mk) => {
  await maybeProactiveHeal({ blobId, bytes, mk }, defaultHealDeps);
};

let eagerEnqueueFn: EagerEnqueueFn = enqueueEager;
let proactiveHealFn: ProactiveHealFn = defaultHeal;

/** Test seam: intercept the apply-side eager enqueue + proactive heal (§6/§7.2). */
export function _setApplyBlobHooks(overrides: {
  enqueueEager?: EagerEnqueueFn;
  proactiveHeal?: ProactiveHealFn;
}): void {
  if (overrides.enqueueEager) eagerEnqueueFn = overrides.enqueueEager;
  if (overrides.proactiveHeal) proactiveHealFn = overrides.proactiveHeal;
}

// ===== Coalesced invalidation (spec §7.6, Laura soft) =====

type Invalidator = (keys: readonly (readonly unknown[])[]) => void;

/** Default: flush every collected query key through the app's shared `queryClient`. */
function defaultInvalidator(keys: readonly (readonly unknown[])[]): void {
  for (const key of keys) void queryClient.invalidateQueries({ queryKey: [...key] });
}

let invalidator: Invalidator = defaultInvalidator;
/** Collected during a page apply, deduped by serialised key, flushed ONCE per page. */
const pendingInvalidations = new Map<string, readonly unknown[]>();

/**
 * Register the query invalidator (Task 8 boot may override; production default
 * flushes through the shared `queryClient`). Tests spy on it to assert the
 * once-per-page coalescing (§7.6).
 */
export function setInvalidator(fn: Invalidator): void {
  invalidator = fn;
}

/** Collect a query key for the next page flush (deduped; never invalidates per-record). */
function collect(key: readonly unknown[]): void {
  pendingInvalidations.set(JSON.stringify(key), key);
}

/**
 * Flush the collected invalidations ONCE (§7.6 — the pull loop calls this per
 * page, never per record, so onboarding/recovery bulk pulls stay composed).
 */
export function flushInvalidations(): void {
  if (pendingInvalidations.size === 0) return;
  const keys = [...pendingInvalidations.values()];
  pendingInvalidations.clear();
  invalidator(keys);
}

// ===== Test seams =====

type OpenFn = (
  mk: MasterKey,
  collection: string,
  blindId: Uint8Array,
  sealed: { nonce: Uint8Array; ciphertext: Uint8Array },
  extractKey: (row: unknown) => string,
) => Promise<unknown>;
type BlindIdFn = (mk: MasterKey, collection: string, key: string) => Promise<Uint8Array>;

let openOverride: OpenFn | null = null;
let blindIdOverride: BlindIdFn | null = null;

/** Test seam: override `openRecord` so apply tests need no real key material. */
export function _setApplyOpenRecord(fn: OpenFn | null): void {
  openOverride = fn;
}
/** Test seam: override `computeBlindId` for the tombstone blind-id reverse lookup. */
export function _setApplyComputeBlindId(fn: BlindIdFn | null): void {
  blindIdOverride = fn;
}
/** Test seam: restore every override, hook, and counter to its production default. */
export function _resetApplyForTests(): void {
  openOverride = null;
  blindIdOverride = null;
  invalidator = defaultInvalidator;
  inertRejectionCount = 0;
  tombstoneCycleCount = 0;
  onViewedRecordTombstoned = () => undefined;
  onSettingsNote = () => undefined;
  eagerEnqueueFn = enqueueEager;
  proactiveHealFn = defaultHeal;
  pendingInvalidations.clear();
}

function activeOpen(): OpenFn {
  return openOverride ?? openRecord;
}
function activeBlindId(): BlindIdFn {
  return blindIdOverride ?? computeBlindId;
}

// ===== Helpers =====

/** LOCAL SHA-256 → base64url of the given bytes (§7.0 — never trust the wire hash). */
async function sha256B64(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes as BufferSource);
  return toBase64Url(new Uint8Array(digest));
}

/**
 * Read the live local row for a collection+key (mirrors the drain's reader).
 * `settings` is the numeric singleton `1`; `vectors` are handled without a data
 * read (they ride their document's lifecycle, §7.5); everything else keys by
 * the sync key on its own table.
 */
async function readLocalRow(collection: SyncCollection, key: string): Promise<unknown> {
  const db = getClientDataDb();
  if (collection === 'settings') return db.settings.get(1);
  return db.table(collection).get(key);
}

/** The owning chat id for a decrypted row, when the collection derives one (§7.6). */
function chatIdOf(collection: SyncCollection, key: string, row: unknown): string | undefined {
  if (collection === 'chats') return key;
  if (collection === 'messages' || collection === 'compactionCheckpoints') {
    const r = row as { chatId?: string };
    return typeof r.chatId === 'string' ? r.chatId : undefined;
  }
  return undefined;
}

/** Collect the query keys a just-applied record invalidates (deduped, §7.6). */
function collectFor(collection: SyncCollection, key: string, chatId: string | undefined): void {
  switch (collection) {
    case 'chats':
      collect(QK.chats);
      collect(QK.chat(key));
      break;
    case 'messages':
      collect(QK.chats);
      if (chatId) collect(QK.chat(chatId));
      break;
    case 'personas':
      collect(QK.personas);
      collect(QK.persona(key));
      break;
    case 'providers':
      collect(QK.providers);
      break;
    case 'mcpServers':
      collect(QK.mcpServers);
      break;
    case 'libraries':
      collect(QK.libraries);
      collect(QK.library(key));
      break;
    case 'documents':
      collect(QK.document(key));
      break;
    case 'settings':
      collect(QK.settings);
      break;
    case 'seedTemplates':
      collect(QK.seedTemplates);
      collect(QK.seedTemplate(key));
      break;
    case 'mindspaces':
      collect(QK.mindspaces);
      break;
    case 'compactionCheckpoints':
      if (chatId) collect(QK.compaction(chatId));
      break;
    default:
      break;
  }
}

/**
 * Recompute a chat's device-local derived fields after a chats/messages/
 * checkpoint apply (§7.6): `lastMessageAt` and `bookmarkedMessageCount` from
 * its messages, `activeCompactionId` from its newest checkpoint. These are
 * never synced (§10 deny-list) — they are always rederived locally.
 */
async function recomputeChatDerived(chatId: string): Promise<void> {
  const db = getClientDataDb();
  const chat = await db.chats.get(chatId);
  if (!chat) return;
  const messages = await db.messages.where('chatId').equals(chatId).toArray();
  let lastMessageAt = chat.createdAt;
  let bookmarkedMessageCount = 0;
  for (const m of messages) {
    if (m.createdAt > lastMessageAt) lastMessageAt = m.createdAt;
    if (m.bookmarked) bookmarkedMessageCount += 1;
  }
  const checkpoints = await db.compactionCheckpoints.where('chatId').equals(chatId).toArray();
  const newest = checkpoints.reduce<{ id: string; createdAt: number } | null>(
    (acc, c) => (acc === null || c.createdAt > acc.createdAt ? c : acc),
    null,
  );
  await db.chats.update(chatId, {
    lastMessageAt,
    bookmarkedMessageCount,
    activeCompactionId: newest?.id,
  });
}

/** Whether the outbox holds a pending `delete` for this key (L-3). */
async function hasPendingDelete(collection: SyncCollection, key: string): Promise<boolean> {
  const db = getClientDataDb();
  const entries = await db.syncOutbox.where('[collection+key]').equals([collection, key]).toArray();
  return entries.some((e) => e.op === 'delete');
}

/**
 * Resolve a pulled tombstone's blind id back to its local sync key (§7.3). A
 * tombstone carries only the blind id, so we re-derive the blind id of each
 * known `syncRows` key in the collection and match — the only key source for a
 * body-less record. Returns null when no known row matches (nothing to remove).
 */
async function findKeyByBlindId(
  mk: MasterKey,
  collection: SyncCollection,
  blindIdB64: string,
): Promise<string | null> {
  const db = getClientDataDb();
  const metas = await db.syncRows.where('collection').equals(collection).toArray();
  for (const meta of metas) {
    const bid = toBase64Url(await activeBlindId()(mk, collection, meta.key));
    if (bid === blindIdB64) return meta.key;
  }
  return null;
}

// ===== The pipeline =====

/**
 * Apply one pulled record under spec §7's exact order. Returns a typed outcome;
 * the caller (the pull loop) advances the per-page watermark regardless — even
 * for a rejected/stale/skipped record, so a poison record never wedges the
 * cursor (§7.1).
 *
 * ORDERING NOTE (documented divergence from the literal §7 numbering): the
 * echo (§7.0) and stale-rev guards need the row's `syncRows` entry, which is
 * keyed by the decrypted sync key — unavailable before `openRecord`. For
 * upserts we therefore OPEN FIRST, then run echo/stale keyed by the extracted
 * key. This costs a decryption we must do anyway and preserves the
 * load-bearing invariant verbatim: an echo compares a locally-computed hash
 * and a stale record is skipped — neither mutates local data, and an inert
 * rejection (open failure) also mutates nothing. Tombstones carry no
 * ciphertext, so their key is recovered from the blind id instead.
 */
export async function applyRecord(pulled: SyncPulledRecord): Promise<ApplyOutcome> {
  const mk = useSessionStore.getState().mk;
  if (!mk) return { kind: 'rejected' };

  const collection = pulled.collection;

  // A pulled TOMBSTONE routes through trash for every collection — including the
  // blob-bearing ones (WS-D §8): the row (with its blob bytes) is preserved for
  // the 30-day grace, and the same transaction drops any pending `blob-put`s for
  // the owning key (Larissa L-1). Blob-bearing UPSERTS now join the handled set
  // (WS-D Task 6, §3): they apply through the §4 `applyPulledBlobRow` transform,
  // resolve via the §7.5 rules the blob-spec §3 keys extend, and enqueue their
  // eager refs (§6) after the row lands.
  if (pulled.deleted) return applyTombstone(mk, pulled);
  return applyUpsert(mk, pulled);
}

/** §7.3 — pulled tombstone: route the local row to trash under a 30-day grace. */
async function applyTombstone(mk: MasterKey, pulled: SyncPulledRecord): Promise<ApplyOutcome> {
  const collection = pulled.collection;

  // §7.3a — count every pulled tombstone; a calm notice above the threshold.
  tombstoneCycleCount += 1;
  if (tombstoneCycleCount >= TOMBSTONE_THRESHOLD) {
    await setAttention({ kind: 'tombstone_threshold', count: tombstoneCycleCount });
  }

  const db = getClientDataDb();
  const key = await findKeyByBlindId(mk, collection, pulled.blindId);
  if (key === null) return { kind: 'tombstoned' }; // nothing known locally — no-op

  const meta = await db.syncRows.get([collection, key]);
  // Stale tombstone: an already-superseded rev must not re-trash a row.
  if (meta && pulled.rev <= meta.rev) return { kind: 'stale' };

  // Vectors live in the separate knowledge database and ride their document's
  // lifecycle (§7.5) — a tombstone here just clears the CAS base and outbox.
  if (collection === 'vectors') {
    await db.transaction('rw', db.syncRows, db.syncOutbox, async () => {
      const seqs = await db.syncOutbox
        .where('[collection+key]')
        .equals([collection, key])
        .primaryKeys();
      if (seqs.length > 0) await db.syncOutbox.bulkDelete(seqs);
      await db.syncRows.delete([collection, key]);
    });
    return { kind: 'tombstoned' };
  }

  const local = collection === 'settings' ? undefined : await readLocalRow(collection, key);

  // Row-move + outbox-drop + syncRows-removal in ONE transaction (Larissa L-6):
  // a crash mid-way must never lose the trash safety net.
  await db.transaction(
    'rw',
    db.syncRows,
    db.syncOutbox,
    db.trash,
    db.table(collection),
    async () => {
      if (local !== undefined && local !== null) {
        const now = Date.now();
        const trashRow: TrashRow = {
          id: `${collection}:${key}`,
          collection,
          key,
          row: local,
          deletedAt: now,
          purgeAt: now + THIRTY_DAYS_MS,
        };
        await db.trash.put(trashRow);
        await db.table(collection).delete(key);
      }
      const seqs = await db.syncOutbox
        .where('[collection+key]')
        .equals([collection, key])
        .primaryKeys();
      if (seqs.length > 0) await db.syncOutbox.bulkDelete(seqs);
      await db.syncRows.delete([collection, key]);
    },
  );

  onViewedRecordTombstoned(collection, key);
  const chatId = collection === 'messages' ? chatIdOf(collection, key, local) : undefined;
  collectFor(collection, key, collection === 'chats' ? key : chatId);
  if (collection === 'chats') await recomputeChatDerivedSafe(key);
  else if (chatId) await recomputeChatDerivedSafe(chatId);
  return { kind: 'tombstoned' };
}

/** §7.4/§7.5 — pulled upsert: insert, resolve, or reject onto a tombstone anchor. */
async function applyUpsert(mk: MasterKey, pulled: SyncPulledRecord): Promise<ApplyOutcome> {
  const collection = pulled.collection;
  const db = getClientDataDb();

  // A non-deleted record must carry a body; a missing one is malformed → inert.
  if (!pulled.nonce || !pulled.ciphertext) {
    inertRejectionCount += 1;
    return { kind: 'rejected' };
  }

  // §7.1 — open; ANY throw (GCM / codec / blind-id re-check) is an inert rejection.
  let row: unknown;
  try {
    row = await activeOpen()(
      mk,
      collection,
      fromBase64Url(pulled.blindId),
      { nonce: fromBase64Url(pulled.nonce), ciphertext: fromBase64Url(pulled.ciphertext) },
      extractKeyFor(collection),
    );
  } catch {
    inertRejectionCount += 1;
    return { kind: 'rejected' };
  }

  // Built-in mindspaces never sync (engine spec §12.5, apply side): a sealed
  // built-in from another device (or a pre-fix recovery) is inert — its uuid is
  // device-local by construction and applying it would duplicate the seeded seven.
  if (collection === 'mindspaces' && (row as { builtIn?: boolean }).builtIn === true) {
    return { kind: 'rejected' };
  }

  const key = extractKeyFor(collection)(row);
  const meta = await db.syncRows.get([collection, key]);

  // §7.0 — echo shortcut: LOCAL hash of the pulled ciphertext vs our stored hash.
  if (meta) {
    const localHash = await sha256B64(fromBase64Url(pulled.ciphertext));
    if (localHash === meta.ciphertextHash) {
      // Our own re-delivered write: no data change, but track the server rev.
      if (pulled.rev > meta.rev) {
        await db.syncRows.update([collection, key], { rev: pulled.rev });
      }
      return { kind: 'echo' };
    }
    // Stale-rev guard (M-7): a lower/equal rev is a replay — ignore.
    if (pulled.rev <= meta.rev) return { kind: 'stale' };
  }

  // Vectors ride their document's lifecycle (§7.5) — never materialised here;
  // track the server rev + local ciphertext hash so we neither re-pull nor
  // drag the embeddings engine into the apply path.
  if (collection === 'vectors') {
    const localHash = await sha256B64(fromBase64Url(pulled.ciphertext));
    const next: SyncRowMeta = { collection, key, rev: pulled.rev, ciphertextHash: localHash };
    await db.syncRows.put(next);
    return { kind: 'skipped' };
  }

  const local = await readLocalRow(collection, key);
  const localHash = await sha256B64(fromBase64Url(pulled.ciphertext));

  if (local === undefined || local === null) {
    // §7.4 H-1 (NON-NEGOTIABLE) — a live pulled-tombstone trash entry is a
    // terminal anchor; an honest server can never deliver an upsert for a blind
    // id it tombstoned. Reject inertly, keep the trash row, raise the tamper alarm.
    const trashRow = await db.trash.get(`${collection}:${key}`);
    if (trashRow) {
      await setAttention({ kind: 'tamper' });
      return { kind: 'tamper' };
    }
    // §7.4 L-3 — a pending local delete wins locally too; suppress the insert.
    if (await hasPendingDelete(collection, key)) return { kind: 'suppressed' };

    await applyPulledRow(collection, key, row, pulled.rev, localHash, undefined);
    await afterApplied(collection, key, row);
    if (isBlobCollection(collection)) await afterBlobApplied(mk, collection, key);
    return { kind: 'inserted' };
  }

  // §7.5 — conflict: the pure per-collection rule decides the winner.
  const resolution = resolveConflict(collection, local, row);
  if (resolution.note) onSettingsNote(resolution.note);

  if (resolution.winner === 'pulled') {
    await applyPulledRow(collection, key, row, pulled.rev, localHash, local);
    await afterApplied(collection, key, row);
    if (isBlobCollection(collection)) await afterBlobApplied(mk, collection, key);
    return { kind: 'resolved', winner: 'pulled' };
  }

  // Local wins: keep the local data. Adopt the server rev as the new CAS base
  // (a metadata-only update, not a local-data mutation — §12.3 / M-1 precedent)
  // so a subsequent re-push does not re-conflict, and enqueue the re-push when
  // the local row is strictly newer knowledge (repush).
  await db.transaction('rw', db.syncRows, db.syncOutbox, async () => {
    if (meta) {
      await db.syncRows.update([collection, key], { rev: pulled.rev });
    } else {
      // No prior CAS base — e.g. a post-link-reset backfill row the server turned
      // out to already hold (the L-1 "server forgot then remembered" edge). We
      // MUST establish a base here: otherwise the re-push below pushes baseRev=0
      // again, re-conflicts, and `backfillPending` never clears (the pump wedges
      // on "Uploading… N of M" forever). Adopt the server rev; the hash tracks the
      // pulled ciphertext per the §7.0 echo convention until the repush acks.
      await db.syncRows.put({ collection, key, rev: pulled.rev, ciphertextHash: localHash });
    }
    if (resolution.repush) {
      await db.syncOutbox.add({ collection, key, op: 'upsert', enqueuedAt: Date.now() });
    }
  });
  return { kind: 'resolved', winner: 'local' };
}

/**
 * Write a pulled row into its local table and update the CAS metadata in one
 * transaction. Device-local / settings fields are restored from the local row
 * per §10 before the write.
 */
async function applyPulledRow(
  collection: SyncCollection,
  key: string,
  row: unknown,
  rev: number,
  ciphertextHash: string,
  local: unknown | undefined,
): Promise<void> {
  const db = getClientDataDb();
  // Blob-bearing rows use the §4 transform: it preserves local bytes when the
  // pulled ref still matches and otherwise leaves the placeholder state (ref
  // present, bytes absent) for the fetch strategy (§6). Non-blob rows restore
  // their device-local fields as before (§10).
  const toStore = isBlobCollection(collection)
    ? applyPulledBlobRow(collection, row, local)
    : restoreLocalFields(collection, row, local);
  const meta: SyncRowMeta = { collection, key, rev, ciphertextHash };
  const table = collection === 'settings' ? db.settings : db.table(collection);
  await db.transaction('rw', table, db.syncRows, async () => {
    // biome-ignore lint/suspicious/noExplicitAny: Dexie's per-table row type is opaque here.
    await table.put(toStore as any);
    await db.syncRows.put(meta);
  });
}

/** Post-apply side effects: derived recompute for chats + query invalidation (§7.6). */
async function afterApplied(collection: SyncCollection, key: string, row: unknown): Promise<void> {
  const chatId = chatIdOf(collection, key, row);
  collectFor(collection, key, chatId);
  if (collection === 'chats') await recomputeChatDerivedSafe(key);
  else if (chatId) await recomputeChatDerivedSafe(chatId);
}

/**
 * Post-apply blob step (WS-D §6/§7.2): for the just-stored blob row, enqueue the
 * EAGER refs (thumbnails, avatars) for fetch when their bytes are absent and the
 * blob is not server-terminal, and proactively heal any ref whose bytes this
 * device holds after its own prior delete/replace (§7.2 M-2b, a no-op unless the
 * id is in the locally-removed set). Artefact originals and attachment images
 * are LAZY — never enqueued here (Task 8's hook fetches them on view).
 */
async function afterBlobApplied(
  mk: MasterKey,
  collection: SyncCollection,
  key: string,
): Promise<void> {
  const stored = await readLocalRow(collection, key);
  if (typeof stored !== 'object' || stored === null) return;
  const row = stored as Record<string, unknown>;
  const eagerFields = EAGER_BYTES_FIELDS[collection];

  for (const spec of blobFieldsOf(collection)) {
    const ref = row[spec.refField];
    if (!isBlobRefValue(ref)) continue; // null / absent — nothing to fetch or heal

    const bytes = row[spec.bytesField];
    const hasLocalBytes = bytes instanceof Blob && bytes.size > 0;

    if (hasLocalBytes) {
      const buf = new Uint8Array(await bytes.arrayBuffer());
      await proactiveHealFn(ref.blobId, buf, mk);
    }

    if (eagerFields?.has(spec.bytesField) && !hasLocalBytes && row[spec.oversizedField] !== true) {
      eagerEnqueueFn(collection, key, spec.bytesField, ref);
    }
  }
}

/** A present, well-formed `BlobRef` (a `null`/absent ref is skipped, §4). */
function isBlobRefValue(value: unknown): value is BlobRef {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { blobId?: unknown }).blobId === 'string' &&
    typeof (value as { bytes?: unknown }).bytes === 'number'
  );
}

/** Recompute a chat's derived fields, tolerating a since-deleted chat. */
async function recomputeChatDerivedSafe(chatId: string): Promise<void> {
  try {
    await recomputeChatDerived(chatId);
  } catch {
    // A concurrently-removed chat is not an apply failure — derived fields are
    // device-local and self-heal on the next recompute.
  }
}
