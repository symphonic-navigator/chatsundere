// SPDX-License-Identifier: AGPL-3.0-only
import { mintBlobId } from '@chatsundere/crypto';
import type { BlobRef, SyncCollection } from '@chatsundere/shared-types';
import { restoreLocalFields, stripForSeal } from './strip.js';

/**
 * The `BlobRef` transform for the three blob-bearing collections (WS-D §4). The
 * §4 field table is its single source of truth: seal-side it swaps local `Blob`
 * fields for `BlobRef` fields (minting ids on first push) and drops the bytes so
 * the wire row NEVER carries them; apply-side it stores the pulled refs and
 * preserves local bytes only when the ref still matches.
 *
 * SECURITY (spec §11) `[L]`:
 *  - the wire row never carries `Blob` bytes — only the ref (blobId + size).
 *  - blobIds are `mintBlobId()` random, never content-derived (§11.3); one
 *    blobId is minted per (row, field), reused across re-seals for stability
 *    (§7.1 idempotent re-PUT), never shared.
 *  - avatar removal is `blobRef: null`, NEVER a tombstone (§4 terminality trap).
 */

/**
 * Sealed-body overhead over the plaintext: nonce (12) + GCM tag (16). Mirrors
 * `packages/crypto/src/sync-blob/seal.ts` (`body = nonce(12) || GCM ciphertext`,
 * and GCM ciphertext = plaintext + 16-byte tag) and the sync-service's
 * `MIN_BODY_BYTES = 28`. `BlobRef.bytes` is the ciphertext body size, computed
 * here without sealing so the transform stays pure and IO-free; a change to the
 * blob envelope layout must update this constant in lockstep.
 */
const SEALED_BLOB_OVERHEAD_BYTES = 28;

/** One local `Blob` field and its persisted ref/sentinel siblings (§4 table). */
interface BlobFieldSpec {
  /** The local `Blob` field name (bytes live here; never on the wire). */
  bytes: string;
  /** The persisted `BlobRef` field name. */
  ref: string;
  /** The durable §7.3 oversize sentinel field name. */
  oversized: string;
  /**
   * `personaAvatars` only: on removal the ref becomes `null` (a first-class
   * "no avatar" state), never dropped and never a tombstone (§4).
   */
  nullableRef: boolean;
}

/** The §4 field table — the single source of truth for both directions. */
const BLOB_FIELDS: Partial<Record<SyncCollection, readonly BlobFieldSpec[]>> = {
  artefacts: [
    { bytes: 'blob', ref: 'blobRef', oversized: 'blobOversized', nullableRef: false },
    {
      bytes: 'thumbBlob',
      ref: 'thumbBlobRef',
      oversized: 'thumbBlobOversized',
      nullableRef: false,
    },
  ],
  attachments: [{ bytes: 'blob', ref: 'blobRef', oversized: 'blobOversized', nullableRef: false }],
  personaAvatars: [
    { bytes: 'blob', ref: 'blobRef', oversized: 'blobOversized', nullableRef: true },
  ],
};

/** A freshly-minted blob whose bytes still need a PUT (the enqueue site queues it). */
export interface NewBlob {
  blobId: string;
  /** The plaintext `Blob` to seal + PUT (named `bytes` per the WS-D §4 contract). */
  bytes: Blob;
}

/** The seal-side result: the wire row (no bytes) plus any newly-minted puts. */
export interface StrippedBlobRow {
  wireRow: unknown;
  newBlobs: NewBlob[];
}

/** Whether a collection carries blob fields (drives the seal/apply seams). */
export function isBlobCollection(collection: SyncCollection): boolean {
  return collection in BLOB_FIELDS;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isBlobRef(value: unknown): value is BlobRef {
  return isRecord(value) && typeof value.blobId === 'string' && typeof value.bytes === 'number';
}

/** Present bytes = a non-empty `Blob` (an absent/empty field is "no bytes"). */
function hasBytes(value: unknown): value is Blob {
  return value instanceof Blob && value.size > 0;
}

/**
 * Seal-side strip for a blob-bearing collection (§4). Applies WS-C's ordinary
 * strip to the non-blob fields, then for each blob field: mints a ref for
 * unminted present bytes (or reuses the existing ref for stability across
 * re-seals), drops the `Blob` field from the wire row, and carries the oversize
 * sentinel. Returns the wire row plus the newly-minted blobs so the enqueue site
 * (WS-D §5) can queue their PUTs. A non-blob collection passes straight through.
 */
export function stripBlobsForSeal(collection: SyncCollection, row: unknown): StrippedBlobRow {
  const specs = BLOB_FIELDS[collection];
  const base = stripForSeal(collection, row);
  if (!specs || !isRecord(base) || !isRecord(row)) {
    return { wireRow: base, newBlobs: [] };
  }

  const wireRow = base;
  const newBlobs: NewBlob[] = [];
  for (const spec of specs) {
    const bytes = row[spec.bytes];
    // Bytes NEVER cross the wire — drop the field from the sealed row always.
    delete wireRow[spec.bytes];

    if (hasBytes(bytes)) {
      const existing = row[spec.ref];
      if (isBlobRef(existing)) {
        // Ref stability: a row already carrying a ref for present bytes reuses
        // it — a re-seal is a plain idempotent re-PUT (§7.1), no new upload.
        wireRow[spec.ref] = existing;
      } else {
        const blobId = mintBlobId();
        const ref: BlobRef = { blobId, bytes: bytes.size + SEALED_BLOB_OVERHEAD_BYTES };
        wireRow[spec.ref] = ref;
        newBlobs.push({ blobId, bytes });
      }
    } else if (spec.nullableRef) {
      // Avatar removal — a first-class "no avatar" ref, NEVER a tombstone (§4).
      wireRow[spec.ref] = null;
    }
    // Non-nullable field with no bytes: leave any existing ref untouched
    // (placeholder state on the wire); never fabricate one.
  }

  return { wireRow, newBlobs };
}

/**
 * Apply-side handling for a pulled blob-bearing row (§4). Delegates the non-blob
 * fields to WS-C's `restoreLocalFields`, then for each blob field preserves the
 * local bytes when the pulled ref still matches (same blobId) and otherwise
 * leaves the row in the placeholder state (ref present, bytes absent) — bytes
 * arrive later per the fetch strategy (§6). Sentinel-aware: a synced
 * `blobOversized` rides through from the pulled row. A non-blob collection is
 * handled entirely by `restoreLocalFields`.
 */
export function applyPulledBlobRow(
  collection: SyncCollection,
  pulled: unknown,
  local: unknown | undefined,
): unknown {
  const base = restoreLocalFields(collection, pulled, local);
  const specs = BLOB_FIELDS[collection];
  if (!specs || !isRecord(base)) return base;

  const out = base;
  const localRow = isRecord(local) ? local : undefined;
  const pulledRow = isRecord(pulled) ? pulled : undefined;
  for (const spec of specs) {
    const pulledRef = pulledRow?.[spec.ref];
    const localRef = localRow?.[spec.ref];
    const localBytes = localRow?.[spec.bytes];

    if (
      isBlobRef(pulledRef) &&
      isBlobRef(localRef) &&
      pulledRef.blobId === localRef.blobId &&
      hasBytes(localBytes)
    ) {
      // The ref is unchanged and we still hold the bytes — keep them (no re-fetch).
      out[spec.bytes] = localBytes;
    } else {
      // Placeholder state: the ref (from `base`, i.e. the pulled row) stands,
      // the bytes are absent until the fetch strategy hydrates them.
      delete out[spec.bytes];
    }
  }

  return out;
}
