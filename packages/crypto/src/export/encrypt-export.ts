// SPDX-License-Identifier: LGPL-3.0-only

import { fromBase64Url, toBase64Url } from '../encoding/base64url.js';
import { CryptoError } from '../errors.js';
import { aeadDecrypt, aeadEncrypt } from '../primitives/aead.js';
import {
  addIntegrityHmac,
  deriveIntegrityKey,
  verifyIntegrityHmac,
} from '../primitives/integrity.js';
import { type Argon2idParams, argon2id, hkdfSha256 } from '../primitives/kdf.js';
import { getRandomBytes } from '../primitives/random.js';
import { ALGO_VERSION, type AMK, ARGON2ID_PARAMS, WRAP_ALGO, asAmk } from '../types.js';

/** Which kind of transfer pack the ciphertext encloses. */
export type EnclosedFormat = 'chatsundere/persona' | 'chatsundere/knowledge';

/** Argon2id parameters stored with the container so a future cost bump can still decrypt old files. */
export interface ExportKdfParams {
  readonly name: 'argon2id';
  readonly salt: string; // base64url
  readonly memorySizeKiB: number;
  readonly iterations: number;
  readonly parallelism: number;
  readonly hashLength: number;
}

/** A password-encrypted transfer pack: metadata plus the AES-256-GCM ciphertext. */
export interface EncryptedContainer {
  readonly algoVersion: string;
  readonly enclosedFormat: EnclosedFormat;
  readonly kdf: ExportKdfParams;
  readonly nonce: string; // base64url
  readonly integrityHmac: string; // base64url
  readonly payload: Uint8Array; // ciphertext
}

const EXPORT_INFO = 'chatsundere-export-v1';

// Ceilings on the container-supplied KDF parameters. An export pack is
// attacker-influenceable input crossing a trust boundary, so decrypt must
// refuse absurd Argon2id costs (which would allocate gigabytes before a
// password is even tried). 512 MiB is 8x the 64 MiB ARGON2ID_PARAMS default —
// generous ADR headroom for a future cost bump, without leaving the tab-OOM
// vector open on a mobile-first target.
const KDF_LIMITS = {
  saltMin: 8,
  saltMax: 64,
  memoryMaxKiB: 524_288, // 512 MiB
  iterationsMax: 20,
  parallelismMax: 4,
  hashLengthMin: 16,
  hashLengthMax: 64,
} as const;

/** Reject out-of-bounds container KDF parameters before spending memory on them. */
function assertKdfWithinLimits(kdf: ExportKdfParams, saltLength: number): void {
  const ok =
    kdf.name === 'argon2id' &&
    saltLength >= KDF_LIMITS.saltMin &&
    saltLength <= KDF_LIMITS.saltMax &&
    kdf.memorySizeKiB >= 1 &&
    kdf.memorySizeKiB <= KDF_LIMITS.memoryMaxKiB &&
    kdf.iterations >= 1 &&
    kdf.iterations <= KDF_LIMITS.iterationsMax &&
    kdf.parallelism >= 1 &&
    kdf.parallelism <= KDF_LIMITS.parallelismMax &&
    kdf.hashLength >= KDF_LIMITS.hashLengthMin &&
    kdf.hashLength <= KDF_LIMITS.hashLengthMax;
  if (!ok) {
    throw new CryptoError('invalid_input', 'export KDF parameters are out of bounds');
  }
}

function exportAad(enclosedFormat: EnclosedFormat): Uint8Array {
  return new TextEncoder().encode(`${EXPORT_INFO}::${enclosedFormat}`);
}

async function deriveExportKey(
  password: string,
  salt: Uint8Array,
  params: Argon2idParams,
): Promise<AMK> {
  const stretched = await argon2id(password, salt, params);
  return asAmk(await hkdfSha256(stretched, salt, EXPORT_INFO));
}

/**
 * Encrypt a transfer-pack byte stream under a freely chosen password. Derives a
 * data key via Argon2id + HKDF, seals with AES-256-GCM, and binds the enclosed
 * format into the AAD. The password is never stored.
 */
export async function encryptExportPack(
  password: string,
  packBytes: Uint8Array,
  enclosedFormat: EnclosedFormat,
): Promise<EncryptedContainer> {
  const salt = getRandomBytes(ARGON2ID_PARAMS.saltLength);
  const key = await deriveExportKey(password, salt, ARGON2ID_PARAMS);
  const aad = exportAad(enclosedFormat);
  const sealed = await addIntegrityHmac(
    await aeadEncrypt(key, packBytes, aad),
    await deriveIntegrityKey(key),
  );
  return {
    algoVersion: ALGO_VERSION,
    enclosedFormat,
    kdf: {
      name: 'argon2id',
      salt: toBase64Url(salt),
      memorySizeKiB: ARGON2ID_PARAMS.memorySizeKiB,
      iterations: ARGON2ID_PARAMS.iterations,
      parallelism: ARGON2ID_PARAMS.parallelism,
      hashLength: ARGON2ID_PARAMS.hashLength,
    },
    nonce: toBase64Url(sealed.nonce),
    integrityHmac: toBase64Url(sealed.integrity_hmac),
    payload: sealed.ciphertext,
  };
}

/**
 * Decrypt a container produced by `encryptExportPack`. A wrong password — and
 * any tampering with the ciphertext, nonce, or bound format — surfaces as
 * `CryptoError('wrong_password')`: the integrity HMAC cannot distinguish the
 * two without the key. Out-of-bounds KDF parameters throw
 * `CryptoError('invalid_input')` before any key derivation.
 */
export async function decryptExportPack(
  password: string,
  container: EncryptedContainer,
): Promise<Uint8Array> {
  const salt = fromBase64Url(container.kdf.salt);
  assertKdfWithinLimits(container.kdf, salt.length);
  const key = await deriveExportKey(password, salt, {
    memorySizeKiB: container.kdf.memorySizeKiB,
    iterations: container.kdf.iterations,
    parallelism: container.kdf.parallelism,
    hashLength: container.kdf.hashLength,
    saltLength: salt.length,
  });
  const aad = exportAad(container.enclosedFormat);
  const wrapped = {
    ciphertext: container.payload,
    nonce: fromBase64Url(container.nonce),
    algo: WRAP_ALGO,
    aad,
    integrity_hmac: fromBase64Url(container.integrityHmac),
  } as const;

  let ok = false;
  try {
    ok = await verifyIntegrityHmac(wrapped, await deriveIntegrityKey(key));
  } catch {
    ok = false;
  }
  if (!ok) {
    throw new CryptoError('wrong_password', 'export integrity check failed');
  }
  return aeadDecrypt(key, wrapped, aad);
}
