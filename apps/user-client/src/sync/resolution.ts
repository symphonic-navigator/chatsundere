// SPDX-License-Identifier: AGPL-3.0-only
import type { SyncCollection } from '@chatsundere/shared-types';

/**
 * Pure, IO-free per-collection conflict resolution (spec §7.5). `resolveConflict`
 * is called on a pulled record that collides with an existing local row and
 * decides which one survives and whether the local edit must be re-pushed so the
 * server converges. No Dexie, no crypto, no side effects — unit-test-ideal.
 */

export type Resolution = {
  winner: 'local' | 'pulled';
  repush: boolean;
  note?: 'settings-applied' | 'settings-precedence';
};

/** Collections resolved by last-write-wins on `updatedAt`, uuid tie-break. */
const LWW_COLLECTIONS: ReadonlySet<SyncCollection> = new Set<SyncCollection>([
  'personas',
  'libraries',
  'documents',
  'providers',
  'mcpServers',
  'chats',
  'messages',
  'mindspaces',
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

/**
 * Last-write-wins on `updatedAt`. Ties (identical clocks) break by uuid — the
 * higher `id` string wins, deterministically (Larissa I-3). When local wins,
 * the local row is strictly newer knowledge than the server delivered, so it
 * must be re-pushed.
 */
function lww(local: LwwRow, pulled: LwwRow): Resolution {
  if (pulled.updatedAt > local.updatedAt) return { winner: 'pulled', repush: false };
  if (pulled.updatedAt < local.updatedAt) return { winner: 'local', repush: true };
  // Tie: higher uuid wins. Exact equality (same row) resolves to local, no-op.
  if (pulled.id > local.id) return { winner: 'pulled', repush: false };
  return { winner: 'local', repush: local.id > pulled.id };
}

/**
 * Resolve a pulled/local collision for one record (spec §7.5). Blob-bearing
 * collections (`personaAvatars`, `artefacts`, `attachments`) are unhandled in
 * v1 — the apply pipeline skips them before this is reached, so a call here is
 * a programming error and fails loud.
 */
export function resolveConflict(
  collection: SyncCollection,
  local: unknown,
  pulled: unknown,
): Resolution {
  if (LWW_COLLECTIONS.has(collection)) {
    return lww(local as LwwRow, pulled as LwwRow);
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
