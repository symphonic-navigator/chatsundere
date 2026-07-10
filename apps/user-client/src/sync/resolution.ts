// SPDX-License-Identifier: AGPL-3.0-only
import type { SyncCollection } from '@chatsundere/shared-types';
import { canonicalRowBytes } from './content-hash.js';

/**
 * Pure, IO-free per-collection conflict resolution (spec §7.5). `resolveConflict`
 * is called on a pulled record that collides with an existing local row and
 * decides which one survives and whether the local edit must be re-pushed so the
 * server converges. No Dexie, no network, no async, no side effects —
 * unit-test-ideal. (It does import {@link canonicalRowBytes} for the same-
 * timestamp content tiebreak below — a synchronous, deterministic JSON
 * encoding, not a cryptographic operation — so `lww` can stay callable from
 * inside a Dexie transaction, where non-Dexie async work is unsafe.)
 */

export type Resolution = {
  winner: 'local' | 'pulled';
  repush: boolean;
  note?: 'settings-applied' | 'settings-precedence';
};

/**
 * Collections resolved by last-write-wins on `updatedAt`, uuid tie-break. The
 * blob-bearing `artefacts` and `attachments` join here (WS-D §3): both carry an
 * `id` + `updatedAt` (the latter engine-stamped for `attachments` by WS-C's v33
 * migration), so the generic {@link lww} governs them exactly. `personaAvatars`
 * is LWW too but keyed by `personaId` (no own uuid), handled in its own branch.
 */
const LWW_COLLECTIONS: ReadonlySet<SyncCollection> = new Set<SyncCollection>([
  'personas',
  'libraries',
  'documents',
  'providers',
  'mcpServers',
  'chats',
  'messages',
  'mindspaces',
  'artefacts',
  'attachments',
]);

/** Creation-only / immutable collections: any conflict is an idempotent no-op. */
const IMMUTABLE_COLLECTIONS: ReadonlySet<SyncCollection> = new Set<SyncCollection>([
  'pills',
  'compactionCheckpoints',
  'seedTemplates',
]);

interface LwwRow {
  id: string;
  updatedAt: number;
}
interface StatefulRow {
  state: 'uncommitted' | 'committed' | 'archived';
}
interface VectorStampRow {
  codecVersion: number;
  modelId: string;
  dim: number;
}
interface BodyRow {
  id: string;
  version: number;
  entriesProcessed: number;
}

const JOURNAL_RANK: Record<StatefulRow['state'], number> = {
  uncommitted: 1,
  committed: 2,
  archived: 3,
};

/** Lexicographic byte comparison: negative if `a` < `b`, positive if `a` > `b`. */
function compareBytes(a: Uint8Array, b: Uint8Array): number {
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const diff = (a[i] as number) - (b[i] as number);
    if (diff !== 0) return diff;
  }
  return a.length - b.length;
}

/**
 * Last-write-wins on `updatedAt`. Ties on `updatedAt` for DIFFERENT records
 * break by uuid — the higher `id` string wins, deterministically (Larissa I-3).
 * When local wins, the local row is strictly newer knowledge than the server
 * delivered, so it must be re-pushed.
 *
 * A tie on `updatedAt` for the SAME record (`id` also equal) is a genuine
 * concurrent same-millisecond edit with different content — the uuid
 * tie-break is a no-op here since both sides share one id (Finding C, Task
 * B11). Deliberately NOT `ciphertextHash`: `sealRecord` draws a fresh random
 * nonce per seal, so the ciphertext hash of the same plaintext differs on
 * every device and never converges (Task B9). Instead, tiebreak on
 * {@link canonicalRowBytes} — the deterministic pre-seal JSON encoding both
 * devices compute identically from their own content — compared
 * lexicographically: higher wins. Both devices resolve this same pairwise
 * comparison (just with `local`/`pulled` swapped), so they always agree on the
 * SAME winning content; the losing side sets `repush: true` so it adopts and
 * re-pushes regardless of which device pulls first.
 */
function lww(local: LwwRow, pulled: LwwRow, collection: SyncCollection): Resolution {
  if (pulled.updatedAt > local.updatedAt) return { winner: 'pulled', repush: false };
  if (pulled.updatedAt < local.updatedAt) return { winner: 'local', repush: true };
  if (pulled.id !== local.id) {
    // Tie on different records: higher uuid wins.
    if (pulled.id > local.id) return { winner: 'pulled', repush: false };
    return { winner: 'local', repush: local.id > pulled.id };
  }
  // Same record, same millisecond: content-intrinsic tiebreak.
  const cmp = compareBytes(
    canonicalRowBytes(collection, local),
    canonicalRowBytes(collection, pulled),
  );
  if (cmp === 0) return { winner: 'local', repush: false }; // identical content: no-op
  if (cmp < 0) return { winner: 'pulled', repush: false };
  return { winner: 'local', repush: true };
}

/**
 * Resolve a pulled/local collision for one record (spec §7.5). The blob-bearing
 * collections join the handled set in WS-D (§3): `artefacts`/`attachments` via
 * the generic LWW set above, `personaAvatars` via its own `personaId`-keyed
 * branch. Any still-unhandled collection is a programming error and fails loud.
 */
export function resolveConflict(
  collection: SyncCollection,
  local: unknown,
  pulled: unknown,
): Resolution {
  if (LWW_COLLECTIONS.has(collection)) {
    return lww(local as LwwRow, pulled as LwwRow, collection);
  }

  if (collection === 'personaAvatars') {
    // LWW on `updatedAt` (WS-D §3). Keyed 1:1 by `personaId`, so a pulled/local
    // collision is always the SAME logical avatar — an exact-clock tie is the
    // same row, resolved to local with no repush (no uuid tie-break needed).
    const l = local as { updatedAt: number };
    const p = pulled as { updatedAt: number };
    if (p.updatedAt > l.updatedAt) return { winner: 'pulled', repush: false };
    if (p.updatedAt < l.updatedAt) return { winner: 'local', repush: true };
    return { winner: 'local', repush: false };
  }

  if (IMMUTABLE_COLLECTIONS.has(collection)) {
    // Immutable / creation-only: the record already exists identically.
    return { winner: 'local', repush: false };
  }

  if (collection === 'settings') {
    const l = local as { updatedAt: number };
    const p = pulled as { updatedAt: number };
    // Server wins the whole row — EXCEPT the replay guard (M-8): a pulled row
    // strictly older than local is stale knowledge the server must not roll us
    // back to; keep local and re-push it.
    if (p.updatedAt < l.updatedAt) {
      return { winner: 'local', repush: true, note: 'settings-precedence' };
    }
    return { winner: 'pulled', repush: false, note: 'settings-applied' };
  }

  if (collection === 'memoryJournal') {
    const l = local as StatefulRow;
    const p = pulled as StatefulRow;
    const lr = JOURNAL_RANK[l.state];
    const pr = JOURNAL_RANK[p.state];
    // State precedence: archived > committed > uncommitted.
    if (pr > lr) return { winner: 'pulled', repush: false };
    if (pr < lr) return { winner: 'local', repush: true };
    return { winner: 'local', repush: false };
  }

  if (collection === 'memoryBody') {
    const l = local as BodyRow;
    const p = pulled as BodyRow;
    // Never merged: one whole body wins. Higher version wins; tie-break by
    // entriesProcessed then uuid. The losing body is discarded and re-dreamt
    // by the caller (anti-ping-pong via memoryBodyAdoptsWinner).
    if (p.version !== l.version) {
      return p.version > l.version
        ? { winner: 'pulled', repush: false }
        : { winner: 'local', repush: true };
    }
    if (p.entriesProcessed !== l.entriesProcessed) {
      return p.entriesProcessed > l.entriesProcessed
        ? { winner: 'pulled', repush: false }
        : { winner: 'local', repush: true };
    }
    if (p.id > l.id) return { winner: 'pulled', repush: false };
    return { winner: 'local', repush: l.id > p.id };
  }

  if (collection === 'vectors') {
    const l = local as VectorStampRow;
    const p = pulled as VectorStampRow;
    // Stamp adoption: a compatible pulled chunk is adopted as-is; an
    // incompatible one is kept local (repush:false) and the caller schedules a
    // local re-embed — we never push an incompatible stamp back.
    const compatible =
      p.codecVersion === l.codecVersion && p.modelId === l.modelId && p.dim === l.dim;
    if (compatible) return { winner: 'pulled', repush: false };
    return { winner: 'local', repush: false };
  }

  throw new Error(`resolveConflict: unhandled collection '${collection}'`);
}

/**
 * Anti-ping-pong for `memoryBody` (spec §7.5): a fresh-dream CAS loser adopts
 * the winner rather than re-dreaming forever, iff the winner's processed-entry
 * set already covers the loser's journal view.
 */
export function memoryBodyAdoptsWinner(
  localJournalIds: string[],
  winnerEntriesProcessed: string[],
): boolean {
  const covered = new Set(winnerEntriesProcessed);
  return localJournalIds.every((id) => covered.has(id));
}
