// SPDX-License-Identifier: LGPL-3.0-only

import { deriveDek } from '../dek.js';
import { toBase64Url } from '../encoding/base64url.js';
import { CryptoError } from '../errors.js';
import { getRandomBytes } from '../primitives/random.js';
import type { MasterKey } from '../types.js';

// Blob envelope v1 (blob spec §5). A new pure module beside the record
// envelope: WebCrypto end to end, testable in Bun and the browser alike.
const ENC_CONTEXT = 'sync/blobs-v1';
const NONCE_CONTEXT = 'sync/blobs-nonce-v1';
const NONCE_BYTES = 12;
const BLOB_ID_BYTES = 16;

/** AAD prefix = utf8(BLOB_AAD_PREFIX) || utf8(blobId) — anti-swap + anti-version-confusion. */
export const BLOB_AAD_PREFIX = 'chatsundere-blob-v1';

/** Mints a random 128-bit blob id, base64url (22 chars). */
export function mintBlobId(): string {
  return toBase64Url(getRandomBytes(BLOB_ID_BYTES));
}

async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes as BufferSource));
}

/**
 * Deterministic SIV-style nonce (blob spec §5): a truncated HMAC over
 * `utf8(blobId) || SHA-256(plaintext)`, keyed by a dedicated `nonceKey` that is
 * never the encryption DEK. The full 32-byte plaintext hash enters the HMAC
 * input; truncation applies to the HMAC *output* only. The plaintext hash never
 * leaves this function — it is neither returned nor exported.
 */
async function deriveNonce(
  mk: MasterKey,
  blobId: string,
  plainHash: Uint8Array,
): Promise<Uint8Array> {
  const nonceKey = await deriveDek(mk, NONCE_CONTEXT);
  const hmacKey = await globalThis.crypto.subtle.importKey(
    'raw',
    nonceKey as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const idBytes = new TextEncoder().encode(blobId);
  const input = new Uint8Array(idBytes.length + plainHash.length);
  input.set(idBytes, 0);
  input.set(plainHash, idBytes.length);
  const mac = new Uint8Array(
    await globalThis.crypto.subtle.sign('HMAC', hmacKey, input as BufferSource),
  );
  return mac.slice(0, NONCE_BYTES);
}

function buildAad(blobId: string): Uint8Array {
  const enc = new TextEncoder();
  const prefix = enc.encode(BLOB_AAD_PREFIX);
  const id = enc.encode(blobId);
  const out = new Uint8Array(prefix.length + id.length);
  out.set(prefix, 0);
  out.set(id, prefix.length);
  return out;
}

async function encryptionKey(mk: MasterKey): Promise<CryptoKey> {
  const dek = await deriveDek(mk, ENC_CONTEXT);
  return globalThis.crypto.subtle.importKey(
    'raw',
    dek as BufferSource,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Deterministically seals blob bytes under an MK-derived DEK. Any re-seal of
 * the same `(mk, blobId, bytes)` is byte-identical (SIV nonce) — the load-bearing
 * idempotency property (blob spec §5/§7.1). Returns `body = nonce(12) || GCM
 * ciphertext` and `hash = SHA-256(body)` (the `x-ciphertext-hash` value).
 */
export async function sealBlob(
  mk: MasterKey,
  blobId: string,
  bytes: Uint8Array,
): Promise<{ body: Uint8Array; hash: Uint8Array }> {
  const plainHash = await sha256(bytes);
  const nonce = await deriveNonce(mk, blobId, plainHash);
  const key = await encryptionKey(mk);
  const ciphertext = new Uint8Array(
    await globalThis.crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: nonce as BufferSource,
        additionalData: buildAad(blobId) as BufferSource,
      },
      key,
      bytes as BufferSource,
    ),
  );
  const body = new Uint8Array(nonce.length + ciphertext.length);
  body.set(nonce, 0);
  body.set(ciphertext, nonce.length);
  const hash = await sha256(body);
  return { body, hash };
}

/**
 * Opens a sealed blob body (`nonce || ciphertext`). Verifies the AAD binding
 * (rejects a foreign `blobId` or a v2-tag confusion) and the GCM tag; rejects a
 * truncated body cleanly.
 */
export async function openBlob(
  mk: MasterKey,
  blobId: string,
  body: Uint8Array,
): Promise<Uint8Array> {
  // Minimum sealed body: nonce (12) + GCM tag (16) = 28 bytes.
  if (body.length < NONCE_BYTES + 16) {
    throw new CryptoError('corrupted_data', 'blob body is too short to be a sealed envelope');
  }
  const nonce = body.subarray(0, NONCE_BYTES);
  const ciphertext = body.subarray(NONCE_BYTES);
  const key = await encryptionKey(mk);
  try {
    const plain = await globalThis.crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: nonce as BufferSource,
        additionalData: buildAad(blobId) as BufferSource,
      },
      key,
      ciphertext as BufferSource,
    );
    return new Uint8Array(plain);
  } catch {
    throw new CryptoError('corrupted_data', 'blob failed AEAD verification');
  }
}
