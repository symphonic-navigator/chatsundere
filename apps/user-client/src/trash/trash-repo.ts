// SPDX-License-Identifier: AGPL-3.0-only
import type { SyncCollection } from '@chatsundere/shared-types';
import { uuidv7 } from 'uuidv7';
import { type TrashRow, getClientDataDb } from '../boot/client-data-db.js';
import { enqueueSync, isLinkedForSync } from '../sync/enqueue.js';
import { scheduleClass1Sync } from '../sync/triggers.js';
import { PARENT_FIELD_COLLECTION } from './trash-model.js';

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
      if (linked) enqueueSync(tx, m.collection as SyncCollection, newId, 'upsert');
    }

    // Retire the snapshots; leave the dead-key markers intact forever (§3.9).
    await tx.table('trash').bulkDelete(memberTrashIds);
  });

  if (linked) scheduleClass1Sync();
}
