// SPDX-License-Identifier: AGPL-3.0-only

import { SYNC_COLLECTIONS } from '@chatsundere/shared-types';

/** The accepted collection set (spec §5.4), as a fast membership set. */
const COLLECTION_SET: ReadonlySet<string> = new Set(SYNC_COLLECTIONS);

/** True if `collection` is one of the v1 sync collections. */
export function isSyncCollection(collection: string): boolean {
  return COLLECTION_SET.has(collection);
}
