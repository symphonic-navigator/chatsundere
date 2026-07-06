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

/** Fallback size estimate (bytes) for metadata that cannot be JSON-serialised. */
const UNSERIALISABLE_METADATA_BYTES = 256;

/** Approximate persisted size of a row in bytes: the fixed int4_L vector size plus serialised metadata. */
export function rowBytes(
  tags: Record<string, string>,
  numeric: Record<string, number>,
  metadata: unknown,
): number {
  // `tags`/`numeric` are typed string/number records, always JSON-safe.
  const tagBytes = JSON.stringify(tags).length;
  const numBytes = JSON.stringify(numeric).length;
  return I4L_VECTOR_BYTES + tagBytes + numBytes + metadataBytes(metadata);
}

/**
 * Byte size of the serialised metadata. IndexedDB's structured clone can persist
 * values that `JSON.stringify` throws on (BigInt) or serialises to `undefined`
 * (functions, symbols, circular graphs), so a bare stringify would turn an
 * otherwise-valid write into an uncaught exception. Fall back to a fixed
 * conservative estimate instead of letting the write path blow up.
 */
function metadataBytes(metadata: unknown): number {
  if (metadata === undefined) return 0;
  try {
    const json = JSON.stringify(metadata);
    return json === undefined ? UNSERIALISABLE_METADATA_BYTES : json.length;
  } catch {
    return UNSERIALISABLE_METADATA_BYTES;
  }
}
