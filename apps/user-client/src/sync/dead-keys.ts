// SPDX-License-Identifier: AGPL-3.0-only
import type { SyncCollection } from '@chatsundere/shared-types';
import { getClientDataDb } from '../boot/client-data-db.js';

/** §3.9 — record a key's server-authoritative death; the permanent H-1 anchor. */
export async function markDead(collection: SyncCollection, key: string): Promise<void> {
  await getClientDataDb().deadKeys.put({
    id: `${collection}:${key}`,
    collection,
    key,
    diedAt: Date.now(),
  });
}

/** §3.9 — whether this key is a tombstoned identity that must never be re-inserted. */
export async function isDeadKey(collection: SyncCollection, key: string): Promise<boolean> {
  return (await getClientDataDb().deadKeys.get(`${collection}:${key}`)) !== undefined;
}
