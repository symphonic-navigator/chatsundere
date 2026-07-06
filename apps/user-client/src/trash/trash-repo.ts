// SPDX-License-Identifier: AGPL-3.0-only
import type { SyncCollection } from '@chatsundere/shared-types';
import { uuidv7 } from 'uuidv7';
import { type TrashRow, getClientDataDb } from '../boot/client-data-db.js';
import { blobFieldsOf, isBlobRef } from '../sync/blob-transform.js';
import { enqueueBlobPut, enqueueSync, isLinkedForSync } from '../sync/enqueue.js';
import { scheduleClass1Sync } from '../sync/triggers.js';
import { PARENT_FIELD_COLLECTION, type TrashEntityKind } from './trash-model.js';

/** One grouped restore-unit card in the trashcan surface (§3.3). */
export interface TrashCard {
  /** The card's identifier = highest trashed ancestor's trash id (`${collection}:${key}`). */
  cardKey: string;
  /** The card ROOT's kind — drives icon + title. */
  entityKind: TrashEntityKind;
  title: string;
  /** Descendant tallies; `items` is always present, the rest only when > 0. */
  counts: { chats?: number; memories?: number; documents?: number; items: number };
  deletedAt: number;
}

/** Read a non-empty string field off an unknown snapshot; absent/empty reads as null. */
function readStr(row: unknown, field: string): string | null {
  const record = (row ?? {}) as Record<string, unknown>;
  const value = record[field];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Derive a card title from the root's collection + snapshot, per its title field (§3.8). */
function titleOf(root: TrashRow): string {
  switch (root.collection) {
    case 'personas':
    case 'libraries':
      return readStr(root.row, 'name') ?? root.key;
    case 'chats':
      return readStr(root.row, 'title') ?? 'Untitled chat';
    case 'documents':
      return readStr(root.row, 'title') ?? root.key;
    case 'memoryJournal':
    case 'memoryBody': {
      const content = readStr(root.row, 'content');
      if (content === null) return root.key;
      const trimmed = content.trim();
      return trimmed.length > 60 ? `${trimmed.slice(0, 60)}…` : trimmed;
    }
    default:
      return root.key;
  }
}

/**
 * List the trashcan as grouped restore-unit cards (§3.3): one card per highest
 * trashed ancestor; descendants fold in as counts. Sorted most-recent first.
 */
export async function listTrashCards(): Promise<TrashCard[]> {
  const db = getClientDataDb();
  const all = await db.trash.toArray();
  const byId = new Map(all.map((r) => [r.id, r] as const));

  const groups = new Map<string, TrashRow[]>();
  for (const r of all) {
    const cardKey = cardKeyOf(r, byId);
    const bucket = groups.get(cardKey);
    if (bucket) bucket.push(r);
    else groups.set(cardKey, [r]);
  }

  const cards: TrashCard[] = [];
  for (const [cardKey, members] of groups) {
    const root = byId.get(cardKey);
    if (root === undefined) continue; // defensive — cardKey is always a member id
    const descendants = members.filter((m) => m.id !== cardKey);
    const counts: TrashCard['counts'] = { items: descendants.length };
    const chats = descendants.filter((d) => d.entityKind === 'chat').length;
    const memories = descendants.filter((d) => d.entityKind === 'memory').length;
    const documents = descendants.filter((d) => d.entityKind === 'document').length;
    if (chats > 0) counts.chats = chats;
    if (memories > 0) counts.memories = memories;
    if (documents > 0) counts.documents = documents;
    cards.push({
      cardKey,
      entityKind: root.entityKind,
      title: titleOf(root),
      counts,
      deletedAt: root.deletedAt,
    });
  }

  return cards.sort((a, b) => b.deletedAt - a.deletedAt);
}

/**
 * The card a trashed row belongs to: its highest TRASHED ancestor's trash id
 * (`${collection}:${key}`). Computed by walking `parentRef` while the parent is
 * itself in trash — NOT the denormalised `rootGroup` hint (§3.2/§3.3). This is
 * what folds a chat into its persona card once the persona is also deleted.
 */
export function cardKeyOf(row: TrashRow, byId: ReadonlyMap<string, TrashRow>): string {
  let cur = row;
  for (;;) {
    const pr = cur.parentRef;
    if (!pr) break;
    const parentCollection = PARENT_FIELD_COLLECTION[pr.field];
    if (!parentCollection) break;
    const parent = byId.get(`${parentCollection}:${pr.id}`);
    if (parent === undefined) break; // parent not trashed → cur is the highest trashed ancestor
    cur = parent;
  }
  return cur.id;
}

/** Purge a whole trash card: delete its snapshot rows from db.trash only (§3.6).
 *  LOCAL-ONLY — never touches syncOutbox (I-3) or deadKeys (§3.9). */
export async function purgeCard(cardKey: string): Promise<void> {
  const db = getClientDataDb();
  const all = await db.trash.toArray();
  const memberIds = rowsOfCard(cardKey, all).map((r) => r.id);
  if (memberIds.length > 0) await db.trash.bulkDelete(memberIds);
}

/** §3.7 — retire this device's stale trash card for an entity restored elsewhere.
 *  Deletes only the exact keyed snapshot; each restored descendant carries its own
 *  restoredFrom, so peers retire each as they pull. No-op when nothing matches. */
export async function retireTrashByOriginalKey(
  collection: SyncCollection,
  key: string,
): Promise<void> {
  await getClientDataDb().trash.delete(`${collection}:${key}`);
}

/** All trashed rows belonging to one card (by `cardKey`), from a preloaded row set. */
export function rowsOfCard(cardKey: string, all: readonly TrashRow[]): TrashRow[] {
  const byId = new Map(all.map((r) => [r.id, r] as const));
  return all.filter((r) => cardKeyOf(r, byId) === cardKey);
}

/**
 * The FIXED transaction scope for a restore: every trashable live table plus the
 * trash snapshots and the sync outbox. Dexie needs the table set statically, and
 * we serialise restore against a concurrent apply/purge across all of them (I-4).
 */
const RESTORE_SCOPE: readonly string[] = [
  'personas',
  'chats',
  'messages',
  'pills',
  'attachments',
  'artefacts',
  'personaAvatars',
  'libraries',
  'documents',
  'memoryJournal',
  'memoryBody',
  'compactionCheckpoints',
  'trash',
  'syncOutbox',
];

/** Rewrite pill-id references inside a message's `contentBlocks` (mirror useBranchChat). */
function remapContentBlocks(blocks: unknown, newPillIdByOld: ReadonlyMap<string, string>): unknown {
  if (!Array.isArray(blocks)) return blocks;
  return blocks.map((block) => {
    const b = block as Record<string, unknown>;
    if (b.type === 'pill' && typeof b.pillId === 'string') {
      return { ...b, pillId: newPillIdByOld.get(b.pillId) ?? b.pillId };
    }
    return block;
  });
}

/**
 * Restore a whole trash card as a new-identity cascade (§3.5), in ONE Dexie
 * transaction. H-1 forces fresh ids (an upsert on a tombstoned blindId trips
 * tamper; the old key stays dead in `deadKeys`). Own PKs and `parentRef` foreign
 * keys are remapped to the new ids when the target is in the card, else left on
 * the existing live id; message pill references are rewritten; a `restoredFrom`
 * provenance marker (§3.7) rides inside each sealed payload; fresh upserts are
 * enqueued; and the trash snapshots — but never the dead-key markers (§3.9) — are
 * cleared.
 */
export async function restoreCard(cardKey: string): Promise<void> {
  const db = getClientDataDb();
  const linked = isLinkedForSync();

  await db.transaction('rw', [...RESTORE_SCOPE], async (tx) => {
    const all = (await tx.table('trash').toArray()) as TrashRow[];
    const members = rowsOfCard(cardKey, all);
    if (members.length === 0) return; // nothing to restore

    // Mint fresh ids, keyed by each member's trash id. personaAvatars are keyed by
    // their persona id (PK IS the personaId), so their new key reuses the restored
    // persona's new id — resolved in a second pass once personas are minted.
    const newIdByTrashId = new Map<string, string>();
    for (const m of members) {
      if (m.collection !== 'personaAvatars') newIdByTrashId.set(m.id, uuidv7());
    }
    for (const m of members) {
      if (m.collection !== 'personaAvatars') continue;
      // The avatar's own key is its persona id; reuse the restored persona's new id
      // when that persona is in the card, else keep the existing live persona id.
      const newPersonaId = newIdByTrashId.get(`personas:${m.key}`) ?? m.key;
      newIdByTrashId.set(m.id, newPersonaId);
    }

    // Old-pill-id → new-pill-id, for the message contentBlocks rewrite.
    const newPillIdByOld = new Map<string, string>();
    for (const m of members) {
      if (m.collection === 'pills') {
        const newId = newIdByTrashId.get(m.id);
        if (newId !== undefined) newPillIdByOld.set(m.key, newId);
      }
    }

    const memberTrashIds: string[] = [];
    for (const m of members) {
      memberTrashIds.push(m.id);
      const newId = newIdByTrashId.get(m.id);
      if (newId === undefined) continue; // unreachable — every member is minted above

      const clone = structuredClone(m.row) as Record<string, unknown>;

      // Own PK: personaAvatars key on `personaId`, everything else on `id`.
      if (m.collection === 'personaAvatars') clone.personaId = newId;
      else clone.id = newId;

      // parentRef foreign key → the parent's NEW id when the parent is in the card,
      // else the existing live id (how a child restores under a still-live parent).
      const pr = m.parentRef;
      if (pr) {
        const parentCollection = PARENT_FIELD_COLLECTION[pr.field];
        const remappedParent = parentCollection
          ? newIdByTrashId.get(`${parentCollection}:${pr.id}`)
          : undefined;
        clone[pr.field] = remappedParent ?? pr.id;
      }

      // In-payload references (best-effort, guard-based — never invent fields).
      if ('contentBlocks' in clone) {
        clone.contentBlocks = remapContentBlocks(clone.contentBlocks, newPillIdByOld);
      }
      const kbRef = clone.kbRef;
      if (kbRef !== null && typeof kbRef === 'object') {
        const ref = kbRef as Record<string, unknown>;
        if (typeof ref.libraryId === 'string') {
          ref.libraryId = newIdByTrashId.get(`libraries:${ref.libraryId}`) ?? ref.libraryId;
        }
        if (typeof ref.documentId === 'string') {
          ref.documentId = newIdByTrashId.get(`documents:${ref.documentId}`) ?? ref.documentId;
        }
      }

      // Provenance (§3.7): the entity's ORIGINAL key, sealed inside the payload so a
      // peer pulling this upsert can retire its matching trash card (Task 10).
      clone.restoredFrom = m.key;

      await tx.table(m.collection).put(clone);
      if (linked) {
        enqueueSync(tx, m.collection as SyncCollection, newId, 'upsert');

        // Audit #6 — re-establish the blob channel for every revived ref. A
        // delete → drain → restore otherwise leaves the restored record pointing
        // at a destroyed server object forever (irreversible byte loss).
        for (const spec of blobFieldsOf(m.collection as SyncCollection)) {
          const ref = clone[spec.refField];
          if (!isBlobRef(ref)) continue;

          // Audit #6a: cancel any queued blob-delete that raced this restore —
          // the revived reference is authoritative, the delete must lose.
          const pendingDeletes = (await tx
            .table('syncOutbox')
            .filter((r) => r.op === 'blob-delete' && r.blobId === ref.blobId)
            .primaryKeys()) as number[];
          if (pendingDeletes.length > 0) await tx.table('syncOutbox').bulkDelete(pendingDeletes);

          // Audit #6b: the server object may already be gone (delete drained
          // before the restore). Re-establish it with an idempotent repair PUT
          // under the PRESERVED id — the deterministic SIV re-seal makes a
          // duplicate PUT a byte-identical 200, so enqueueing unconditionally is
          // safe. Only when this device still holds the bytes to seal.
          const bytes = clone[spec.bytesField];
          if (bytes instanceof Blob && bytes.size > 0) {
            enqueueBlobPut(tx, m.collection as SyncCollection, newId, ref.blobId);
          }
        }
      }
    }

    // Retire the snapshots; leave the dead-key markers intact forever (§3.9).
    await tx.table('trash').bulkDelete(memberTrashIds);
  });

  if (linked) scheduleClass1Sync();
}
