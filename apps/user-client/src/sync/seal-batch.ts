// SPDX-License-Identifier: AGPL-3.0-only
import { toBase64Url } from '@chatsundere/crypto';
import type { MasterKey, SealedRecord } from '@chatsundere/crypto';
import type { SyncCollection, SyncPushRecord } from '@chatsundere/shared-types';
import { type NewBlob, isBlobCollection, stripBlobsForSeal } from './blob-transform.js';
import { stripForSeal } from './strip.js';

/**
 * Pure, IO-free sealing and byte-batching for the drain (spec §6, §7.0). The
 * worker owns Dexie and the stores; this module owns turning one coalesced
 * outbox entry into its wire record and grouping records into requests by
 * summed encoded bytes. Both are unit-test-ideal — the crypto is injected so a
 * test can control ciphertext sizes without real key material.
 */

/**
 * Target request size (spec §6.3): batch by summed encoded bytes AND by a hard
 * record count. A request is flushed whenever adding the next record would
 * exceed `maxBytes` or the batch already holds `MAX_RECORDS_PER_BATCH` entries —
 * a dual ceiling, because the server caps both.
 */
export const DEFAULT_MAX_BATCH_BYTES = 4 * 1024 * 1024;

/** Server-mirroring per-request record ceiling (sync-service MAX_PUSH_RECORDS). */
export const MAX_RECORDS_PER_BATCH = 100;

/** The crypto seam the drain consumes (`@chatsundere/crypto` in production). */
export interface SealCryptoDeps {
  computeBlindId: (mk: MasterKey, collection: string, key: string) => Promise<Uint8Array>;
  sealRecord: (
    mk: MasterKey,
    collection: string,
    key: string,
    row: unknown,
  ) => Promise<SealedRecord>;
}

/** One coalesced outbox unit ready to be sealed into a wire record. */
export interface CoalescedEntry {
  collection: SyncCollection;
  key: string;
  op: 'upsert' | 'delete';
  /** Every outbox `seq` this unit covers — deleted together on `ok`. */
  seqs: number[];
  /** The live local row (undefined for deletes — a tombstone carries no body). */
  row: unknown;
  /** The CAS base: the row's `syncRows.rev`, or 0 when the server never knew it. */
  baseRev: number;
}

/** A sealed, wire-ready record plus the local bookkeeping the drain needs. */
export interface PreparedRecord {
  collection: SyncCollection;
  key: string;
  op: 'upsert' | 'delete';
  seqs: number[];
  /** The base64url record posted to the server. */
  record: SyncPushRecord;
  /**
   * The LOCALLY-computed base64url SHA-256 of the sealed ciphertext (§7.0), to
   * be written into `syncRows` on `ok`. Null for tombstones (no ciphertext).
   */
  ciphertextHashB64: string | null;
  /** Summed encoded size used for byte-batching. */
  encodedBytes: number;
  /**
   * Newly-minted blobs whose bytes still need a PUT (WS-D §4/§5). Non-empty only
   * for a blob-bearing collection's upsert whose bytes had no ref yet; the drain
   * (WS-D Task 4) queues these `blob-put`s alongside the record upsert. Always
   * empty for record-only collections and tombstones.
   */
  newBlobs: NewBlob[];
}

/**
 * The encoded size of a wire record for byte-batching (spec §6.3). The
 * base64url ciphertext dominates; the fixed fields add a small constant. A
 * deterministic, allocation-free measure — never a re-serialisation of the
 * megabyte-scale ciphertext.
 */
function encodedBytesOf(record: SyncPushRecord): number {
  const OVERHEAD = 96; // blindId (~43) + collection + envelopeVersion + baseRev + deleted keys
  return (
    OVERHEAD +
    record.blindId.length +
    record.collection.length +
    (record.nonce?.length ?? 0) +
    (record.ciphertext?.length ?? 0) +
    (record.ciphertextHash?.length ?? 0)
  );
}

/**
 * Seal one coalesced entry into its wire record (spec §6.2). Upserts strip
 * device-local fields (§10) then seal; deletes carry only the blind id and
 * `deleted: true` — no nonce, ciphertext, or hash (Larissa I-1 tombstone shape).
 */
export async function prepareRecord(
  deps: SealCryptoDeps,
  mk: MasterKey,
  entry: CoalescedEntry,
): Promise<PreparedRecord> {
  const { collection, key, op, seqs, baseRev } = entry;

  if (op === 'delete') {
    const blindId = await deps.computeBlindId(mk, collection, key);
    const record: SyncPushRecord = {
      blindId: toBase64Url(blindId),
      collection,
      envelopeVersion: 1,
      baseRev,
      deleted: true,
    };
    return {
      collection,
      key,
      op,
      seqs,
      record,
      ciphertextHashB64: null,
      encodedBytes: encodedBytesOf(record),
      newBlobs: [],
    };
  }

  // Blob-bearing collections route through the §4 transform: it strips the
  // `Blob` fields (bytes never cross the wire), attaches refs + sentinels, and
  // surfaces newly-minted blobs for the drain to PUT. Every other collection
  // keeps WS-C's plain strip. Both feed the same sealer.
  let wireRow: unknown;
  let newBlobs: NewBlob[] = [];
  if (isBlobCollection(collection)) {
    const stripped = stripBlobsForSeal(collection, entry.row);
    wireRow = stripped.wireRow;
    newBlobs = stripped.newBlobs;
  } else {
    wireRow = stripForSeal(collection, entry.row);
  }

  const sealed = await deps.sealRecord(mk, collection, key, wireRow);
  const ciphertextHashB64 = toBase64Url(sealed.ciphertextHash);
  const record: SyncPushRecord = {
    blindId: toBase64Url(sealed.blindId),
    collection,
    envelopeVersion: sealed.envelopeVersion,
    baseRev,
    deleted: false,
    nonce: toBase64Url(sealed.nonce),
    ciphertext: toBase64Url(sealed.ciphertext),
    ciphertextHash: ciphertextHashB64,
  };
  return {
    collection,
    key,
    op,
    seqs,
    record,
    ciphertextHashB64,
    encodedBytes: encodedBytesOf(record),
    newBlobs,
  };
}

/**
 * Greedy byte-and-count batching (spec §6.3): fill a request until adding the
 * next record would exceed `maxBytes`, or until the batch already holds
 * `maxRecords` entries, then start a new one. A single record larger than
 * `maxBytes` still gets its own request (the server rejects it as
 * `record_too_large` — never silently dropped). The record ceiling mirrors the
 * server's per-request cap, which rejects a whole push above `maxRecords`.
 */
export function batchByBytes<T extends { encodedBytes: number }>(
  items: readonly T[],
  maxBytes: number,
  maxRecords: number = MAX_RECORDS_PER_BATCH,
): T[][] {
  const batches: T[][] = [];
  let current: T[] = [];
  let running = 0;
  for (const item of items) {
    if (
      current.length > 0 &&
      (running + item.encodedBytes > maxBytes || current.length >= maxRecords)
    ) {
      batches.push(current);
      current = [];
      running = 0;
    }
    current.push(item);
    running += item.encodedBytes;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}
