// SPDX-License-Identifier: LGPL-3.0-only

import { deriveDek } from '../dek.js';
import { CryptoError } from '../errors.js';
import { getRandomBytes } from '../primitives/random.js';
import type { MasterKey } from '../types.js';
import { computeBlindId } from './blind-index.js';
import { decodeRow, encodeRow } from './codec.js';
import { padPlaintext, unpadPlaintext } from './padding.js';

const VERSION_TAG = 'chatsundere-sync-v1';
const NONCE_BYTES = 12;

/** Collections whose plaintext is size-padded because size alone is a sidechannel (spec §5.3). */
export const PADDED_COLLECTIONS: ReadonlySet<string> = new Set([
  'personas',
  'memoryBody',
  'memoryJournal',
  'seedTemplates',
]);

/** The sealed form of a record — everything that goes on the sync wire. */
export interface SealedRecord {
  blindId: Uint8Array;
  envelopeVersion: 1;
  nonce: Uint8Array;
  ciphertext: Uint8Array;
  ciphertextHash: Uint8Array;
}

/** AAD = utf8('chatsundere-sync-v1') || utf8(collection) || blindId — anti-swap + anti-version-confusion. */
function buildAad(collection: string, blindId: Uint8Array): Uint8Array {
  const enc = new TextEncoder();
  const v = enc.encode(VERSION_TAG);
  const c = enc.encode(collection);
  const out = new Uint8Array(v.length + c.length + blindId.length);
  out.set(v, 0);
  out.set(c, v.length);
  out.set(blindId, v.length + c.length);
  return out;
}

async function collectionKey(mk: MasterKey, collection: string): Promise<CryptoKey> {
  const dek = await deriveDek(mk, `sync/collection/${collection}-v1`);
  return globalThis.crypto.subtle.importKey(
    'raw',
    dek as BufferSource,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt'],
  );
}

/** Seals one row for sync: blind id, AES-256-GCM under the collection DEK, padding, hash. */
export async function sealRecord(
  mk: MasterKey,
  collection: string,
  key: string,
  row: unknown,
): Promise<SealedRecord> {
  const blindId = await computeBlindId(mk, collection, key);
  const plaintext = padPlaintext(encodeRow(row), PADDED_COLLECTIONS.has(collection));
  const nonce = getRandomBytes(NONCE_BYTES);
  const cryptoKey = await collectionKey(mk, collection);
  const ciphertext = new Uint8Array(
    await globalThis.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce as BufferSource, additionalData: buildAad(collection, blindId) as BufferSource },
      cryptoKey,
      plaintext as BufferSource,
    ),
  );
  const ciphertextHash = new Uint8Array(
    await globalThis.crypto.subtle.digest('SHA-256', ciphertext as BufferSource),
  );
  return { blindId, envelopeVersion: 1, nonce, ciphertext, ciphertextHash };
}

/** Opens a pulled record; verifies the AAD binding and the inner-key/blind-id match. */
export async function openRecord(
  mk: MasterKey,
  collection: string,
  blindId: Uint8Array,
  sealed: { nonce: Uint8Array; ciphertext: Uint8Array },
  extractKey: (row: unknown) => string,
): Promise<unknown> {
  const cryptoKey = await collectionKey(mk, collection);
  let plainBuf: ArrayBuffer;
  try {
    plainBuf = await globalThis.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: sealed.nonce as BufferSource, additionalData: buildAad(collection, blindId) as BufferSource },
      cryptoKey,
      sealed.ciphertext as BufferSource,
    );
  } catch {
    throw new CryptoError('corrupted_data', 'sync record failed AEAD verification');
  }
  const row = decodeRow(unpadPlaintext(new Uint8Array(plainBuf)));
  const expected = await computeBlindId(mk, collection, extractKey(row));
  if (expected.length !== blindId.length || !expected.every((b, i) => b === blindId[i])) {
    throw new CryptoError('corrupted_data', 'sync record key does not match its blind id');
  }
  return row;
}
