// SPDX-License-Identifier: LGPL-3.0-only

import { argon2id as argon2idWasm } from 'hash-wasm';
import { CryptoError } from '../errors.js';

/**
 * HKDF-SHA256 expansion. Salt may be empty (RFC 5869 §3.1 allows it).
 * Returns the requested number of bytes (default 32).
 */
export async function hkdfSha256(
  ikm: Uint8Array,
  salt: Uint8Array,
  info: string,
  outputLength = 32,
): Promise<Uint8Array> {
  const subtle = globalThis.crypto.subtle;
  const baseKey = await subtle.importKey('raw', ikm as BufferSource, 'HKDF', false, ['deriveBits']);
  const bits = await subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: salt as BufferSource,
      info: new TextEncoder().encode(info),
    },
    baseKey,
    outputLength * 8,
  );
  return new Uint8Array(bits);
}

export interface Argon2idParams {
  readonly memorySizeKiB: number;
  readonly iterations: number;
  readonly parallelism: number;
  readonly hashLength: number;
  readonly saltLength: number;
}

/**
 * Argon2id over UTF-8-encoded passphrase. Used exclusively to derive
 * `local_amk`. Parameters come from `ARGON2ID_PARAMS`; do not call with
 * weaker values without an ADR.
 */
export async function argon2id(
  passphrase: string,
  salt: Uint8Array,
  params: Argon2idParams,
): Promise<Uint8Array> {
  if (salt.length !== params.saltLength) {
    throw new CryptoError('internal', `salt must be ${params.saltLength} bytes`);
  }
  return argon2idWasm({
    password: passphrase,
    salt,
    parallelism: params.parallelism,
    iterations: params.iterations,
    memorySize: params.memorySizeKiB,
    hashLength: params.hashLength,
    outputType: 'binary',
  });
}
