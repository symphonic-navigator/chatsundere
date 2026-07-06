// SPDX-License-Identifier: AGPL-3.0-only
import type { SyncCollection } from '@chatsundere/shared-types';

/**
 * The per-collection **sync key** (spec §3.1). This is NOT always a uuid: it is
 * the serialisation the server keys a record by and the value `openRecord`'s
 * `extractKey` must re-derive from the decrypted row to reject a mismatch.
 *
 * - `settings`       → the literal `'1'` (the singleton has no uuid).
 * - `vectors`        → `` `${documentId}#${chunkIndex}` `` (a chunk of a document).
 * - `personaAvatars` → the owning `personaId` (1:1 with a persona, no own id).
 * - every other collection → the row's `id` (its uuid).
 *
 * Both directions live here so seal/enqueue (`syncKeyOfRow`) and open
 * (`extractKeyFor`) can never drift.
 */

/** Minimal structural views of the rows whose key is not a plain `id`. */
interface VectorKeyed {
  documentId: string;
  chunkIndex: number;
}
interface PersonaAvatarKeyed {
  personaId: string;
}
interface IdKeyed {
  id: string;
}

/** Derive the sync key for a row about to be sealed/enqueued (§3.1). */
export function syncKeyOfRow(collection: SyncCollection, row: unknown): string {
  if (collection === 'settings') return '1';
  if (collection === 'vectors') {
    const v = row as VectorKeyed;
    return `${v.documentId}#${v.chunkIndex}`;
  }
  if (collection === 'personaAvatars') {
    return (row as PersonaAvatarKeyed).personaId;
  }
  return (row as IdKeyed).id;
}

/**
 * The extractor `openRecord` re-runs against a decrypted row to re-derive its
 * blind index (§3.1). Agrees with {@link syncKeyOfRow} by construction.
 */
export function extractKeyFor(collection: SyncCollection): (row: unknown) => string {
  return (row: unknown) => syncKeyOfRow(collection, row);
}
