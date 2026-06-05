// SPDX-License-Identifier: LGPL-3.0-only
import { type EncodedVector, I4L_VECTOR_BYTES } from './codec.js';

/** Caller-facing record handed to the store. `vector` is a float embedding; the store encodes it. */
export interface VectorInput {
  id: string;
  collection: string;
  vector: Float32Array;
  tags?: Record<string, string>;
  numeric?: Record<string, number>;
  metadata?: unknown;
  updatedAt: number;
}

/** The row as persisted in IndexedDB: the int4_L `EncodedVector` fields plus filter columns and precomputed byte size. */
export interface VectorRow extends EncodedVector {
  id: string;
  collection: string;
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

/** Approximate persisted size of a row in bytes: the fixed int4_L vector size plus serialised metadata. */
export function rowBytes(
  tags: Record<string, string>,
  numeric: Record<string, number>,
  metadata: unknown,
): number {
  const tagBytes = JSON.stringify(tags).length;
  const numBytes = JSON.stringify(numeric).length;
  const metaBytes = metadata === undefined ? 0 : JSON.stringify(metadata).length;
  return I4L_VECTOR_BYTES + tagBytes + numBytes + metaBytes;
}
