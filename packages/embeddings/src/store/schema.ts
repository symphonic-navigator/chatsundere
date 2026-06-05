// SPDX-License-Identifier: LGPL-3.0-only

/** Caller-facing record handed to the store. `vector` is a float embedding; the store quantises it. */
export interface VectorInput {
  id: string;
  collection: string;
  vector: Float32Array;
  tags?: Record<string, string>;
  numeric?: Record<string, number>;
  metadata?: unknown;
  updatedAt: number;
}

/** The row as persisted in IndexedDB: quantised int8 plus scale/norm and precomputed byte size. */
export interface VectorRow {
  id: string;
  collection: string;
  q: Int8Array;
  scale: number;
  norm: number;
  tags: Record<string, string>;
  numeric: Record<string, number>;
  metadata?: unknown;
  updatedAt: number;
  bytes: number;
}

/**
 * Dexie store-string for the `vectors` table. The primary key is `id`;
 * `collection` and the compound `[collection+updatedAt]` are indexed for the
 * common recency-windowed filter. Tag/numeric predicates are applied in-memory
 * over the narrowed candidate set.
 */
export const VECTORS_STORE_SCHEMA = 'id, collection, [collection+updatedAt]';

/** Approximate persisted size of a row in bytes (int8 vector dominates). */
export function rowBytes(
  q: Int8Array,
  tags: Record<string, string>,
  numeric: Record<string, number>,
  metadata: unknown,
): number {
  const tagBytes = JSON.stringify(tags).length;
  const numBytes = JSON.stringify(numeric).length;
  const metaBytes = metadata === undefined ? 0 : JSON.stringify(metadata).length;
  return q.byteLength + 16 + tagBytes + numBytes + metaBytes; // +16 for scale/norm/updatedAt overhead
}
