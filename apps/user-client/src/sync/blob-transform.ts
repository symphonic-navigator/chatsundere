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

/**
 * Mint a fresh `BlobRef` for a plaintext `Blob` at a write site (WS-D §5,
 * option (a)): the id is random (`mintBlobId`, §11.3) and `bytes` is the sealed
 * ciphertext size (`blob.size + SEALED_BLOB_OVERHEAD_BYTES`) computed without
 * sealing so the write stays IO-free. The write site sets the returned ref on the
 * row (so the drain's phase-1 reader `readBlobBytesById` can resolve the blobId
 * back to its bytes) and enqueues a `blob-put` for the same id in the row's
 * transaction. The overhead constant lives here — the one source of truth for the
 * envelope size, shared with the seal-side strip.
 */
export function mintBlobRefFor(blob: Blob): BlobRef {
  return { blobId: mintBlobId(), bytes: blob.size + SEALED_BLOB_OVERHEAD_BYTES };
}

/** A freshly-minted blob whose bytes still need a PUT (the enqueue site queues it). */
export interface NewBlob {
  blobId: string;
  /** The plaintext `Blob` to seal + PUT (named `bytes` per the WS-D §4 contract). */
  bytes: Blob;
  /** The persisted `BlobRef` field this blob belongs to (drain write-back). */
  refField: string;
  /** The ref to persist onto the live row (drain write-back). */
  ref: BlobRef;
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

/** The resolved field trio for one blob on a row (drain phase 1 + repair §7). */
export interface ResolvedBlobField {
  /** The local `Blob` field name holding the plaintext bytes. */
  bytesField: string;
  /** The persisted `BlobRef` field name. */
  refField: string;
  /** The durable §7.3 oversize sentinel field name. */
  oversizedField: string;
}

/**
 * The resolved field trios for a blob-bearing collection (WS-D §4). The single
 * iterator the apply-side join and the fetch layer walk to enqueue eager refs,
 * kick lazy fetches, and resolve a bytes field back to its ref/sentinel
 * siblings. A non-blob collection yields the empty list.
 */
export function blobFieldsOf(collection: SyncCollection): readonly ResolvedBlobField[] {
  const specs = BLOB_FIELDS[collection];
  if (!specs) return [];
  return specs.map((s) => ({ bytesField: s.bytes, refField: s.ref, oversizedField: s.oversized }));
}

/**
 * Resolve one bytes field (e.g. `thumbBlob`) to its ref/sentinel siblings for a
 * collection (WS-D §4/§6). Returns `undefined` when the collection has no such
 * blob field — the fetch layer's map from a `useBlobBytes(collection, key,
 * field)` request to the ref that drives its GET.
 */
export function resolveBlobFieldByName(
  collection: SyncCollection,
  bytesField: string,
): ResolvedBlobField | undefined {
  return blobFieldsOf(collection).find((f) => f.bytesField === bytesField);
}

/**
 * Find which blob field of a live row a `blobId` belongs to, by matching the
 * row's persisted refs (WS-D §5/§7). Returns the field trio, or `undefined` when
 * no ref on the row names this blob. The single map from a queued `blob-put`/
 * `blob-delete`'s `blobId` back to the row field the drain must seal or the
 * repair must re-ref.
 */
export function resolveBlobFieldById(
  collection: SyncCollection,
  row: unknown,
  blobId: string,
): ResolvedBlobField | undefined {
  const specs = BLOB_FIELDS[collection];
  if (!specs || !isRecord(row)) return undefined;
  for (const spec of specs) {
    const ref = row[spec.ref];
    if (isBlobRef(ref) && ref.blobId === blobId) {
      return { bytesField: spec.bytes, refField: spec.ref, oversizedField: spec.oversized };
    }
  }
  return undefined;
}

/**
 * Read the live plaintext `Blob` a queued `blob-put` names, from LIVE rows only
 * (WS-D §5 — no trash-read upload path, Larissa L-1). Returns `undefined` when
 * the row is gone or no field's ref matches, which the drain treats as
 * "bytes nowhere locally → drop the entry with a diagnostic".
 */
export function readBlobBytesById(
  collection: SyncCollection,
  row: unknown,
  blobId: string,
): Blob | undefined {
  const field = resolveBlobFieldById(collection, row, blobId);
  if (!field || !isRecord(row)) return undefined;
  const bytes = row[field.bytesField];
  return hasBytes(bytes) ? bytes : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Whether a value is a persisted `BlobRef` (blobId + size). */
export function isBlobRef(value: unknown): value is BlobRef {
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
        newBlobs.push({ blobId, bytes, refField: spec.ref, ref });
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
