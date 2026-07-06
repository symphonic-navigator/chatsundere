// SPDX-License-Identifier: AGPL-3.0-only
import type { SyncCollection } from '@chatsundere/shared-types';
import type { Transaction } from 'dexie';
import type { TrashRow } from '../boot/client-data-db.js';
import { deriveTrashMeta } from './trash-model.js';

/** The 30-day trash grace window before auto-purge (§3.3), in milliseconds. */
export const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Snapshot one live plaintext row into `db.trash` inside the caller's delete
 * transaction, BEFORE the row is removed (§3.4). Grouping metadata is derived via
 * {@link deriveTrashMeta}; pass `resolvePersonaForChat` so a chat-child's
 * `rootGroup` lifts to its persona card. The `trash` table must be in the
 * transaction's scope, and this must run before `write` deletes the live rows so
 * the snapshot captures the row's final state.
 */
export async function snapshotRowIntoTrash(
  tx: Transaction,
  now: number,
  collection: SyncCollection,
  key: string,
  row: unknown,
  resolvePersonaForChat?: (chatId: string) => string | null,
): Promise<void> {
  const meta = deriveTrashMeta(collection, key, row, resolvePersonaForChat);
  const trashRow: TrashRow = {
    id: `${collection}:${key}`,
    collection,
    key,
    row,
    deletedAt: now,
    purgeAt: now + THIRTY_DAYS_MS,
    entityKind: meta.entityKind,
    rootGroup: meta.rootGroup,
    parentRef: meta.parentRef,
  };
  await tx.table('trash').put(trashRow);
}
