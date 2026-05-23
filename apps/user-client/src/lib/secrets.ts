// SPDX-License-Identifier: AGPL-3.0-only
import { type MasterKey, deriveDek, getRandomBytes } from '@chatsundere/crypto';

const SECRETS_DEK_CONTEXT = 'block1/secrets-v1';
const NONCE_BYTES = 12;
const VERSION = 1 as const;

export interface EncryptedBlob {
  version: typeof VERSION;
  ciphertext: Uint8Array;
  nonce: Uint8Array;
}

/**
 * Seal a UTF-8 string under the user's MasterKey using a Block-1-scoped DEK.
 * The `slotId` is bound into the GCM auth tag as AAD so blobs sealed for
 * one storage slot cannot be opened under a different slot (defeats
 * ciphertext-swap attacks across rows in IndexedDB).
 *
 * Random 12-byte nonce. Output is structured-clone-safe for Dexie.
 *
 * @param plaintext UTF-8 string to seal.
 * @param mk        The user's MasterKey (held in memory by the session).
 * @param slotId    Stable storage-slot identifier — e.g.
 *                  `'provider/<rowId>/api-key'` or `'cors-proxy/shared-key'`.
 *                  Bound into the AEAD tag; opening with a different
 *                  slotId fails.
 */
export async function sealSecret(
  plaintext: string,
  mk: MasterKey,
  slotId: string,
): Promise<EncryptedBlob> {
  if (slotId.length === 0) throw new Error('sealSecret: slotId must be non-empty');
  const dek = await deriveDek(mk, SECRETS_DEK_CONTEXT);
  const nonce = getRandomBytes(NONCE_BYTES);
  const cryptoKey = await globalThis.crypto.subtle.importKey(
    'raw',
    dek as unknown as BufferSource,
    { name: 'AES-GCM' },
    false,
    ['encrypt'],
  );
  const aad = new TextEncoder().encode(slotId);
  const ciphertextBuf = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce as BufferSource, additionalData: aad as BufferSource },
    cryptoKey,
    new TextEncoder().encode(plaintext) as BufferSource,
  );
  return { version: VERSION, ciphertext: new Uint8Array(ciphertextBuf), nonce };
}

/**
 * Open a previously-sealed blob. Throws if the version is unknown or the
 * AES-GCM auth tag fails (wrong MasterKey, tampered ciphertext, or wrong
 * `slotId`).
 */
export async function openSecret(
  blob: EncryptedBlob,
  mk: MasterKey,
  slotId: string,
): Promise<string> {
  if (slotId.length === 0) throw new Error('openSecret: slotId must be non-empty');
  if (blob.version !== VERSION) {
    throw new Error(`unsupported EncryptedBlob version: ${blob.version}`);
  }
  const dek = await deriveDek(mk, SECRETS_DEK_CONTEXT);
  const cryptoKey = await globalThis.crypto.subtle.importKey(
    'raw',
    dek as unknown as BufferSource,
    { name: 'AES-GCM' },
    false,
    ['decrypt'],
  );
  const aad = new TextEncoder().encode(slotId);
  const plainBuf = await globalThis.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: blob.nonce as BufferSource, additionalData: aad as BufferSource },
    cryptoKey,
    blob.ciphertext as BufferSource,
  );
  return new TextDecoder().decode(plainBuf);
}
