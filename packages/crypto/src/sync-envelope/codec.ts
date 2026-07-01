// SPDX-License-Identifier: LGPL-3.0-only

import { fromBase64Url, toBase64Url } from '../encoding/base64url.js';
import { CryptoError } from '../errors.js';

const RESERVED = '$bytes';

/**
 * Encodes a row to bytes: JSON with every `Uint8Array` field represented as
 * `{"$bytes": "<base64url>"}`. Bare `JSON.stringify` silently corrupts real rows
 * (a `Uint8Array` becomes an index-keyed object; `providers.apiKey` and the
 * `vectors` codes/scales are `Uint8Array`), so this binary-aware codec is used
 * for the sync envelope. `Blob`/`ArrayBuffer` are unrepresentable by design; a
 * genuine `$bytes` key in the input is rejected (reserved).
 */
export function encodeRow(row: unknown): Uint8Array {
  const json = JSON.stringify(row, (_key, value: unknown) => {
    if (value instanceof Uint8Array) return { [RESERVED]: toBase64Url(value) };
    if (typeof Blob !== 'undefined' && value instanceof Blob) {
      throw new CryptoError('invalid_input', 'Blob values are not representable (excluded collection?)');
    }
    if (value instanceof ArrayBuffer) {
      throw new CryptoError('invalid_input', 'ArrayBuffer values are not representable');
    }
    if (
      typeof value === 'object' &&
      value !== null &&
      !Array.isArray(value) &&
      !(value instanceof Uint8Array) &&
      RESERVED in (value as Record<string, unknown>)
    ) {
      throw new CryptoError('invalid_input', 'the key "$bytes" is reserved by the sync codec');
    }
    return value;
  });
  return new TextEncoder().encode(json);
}

/** Decodes codec bytes back to a row, restoring `Uint8Array` fields. */
export function decodeRow(bytes: Uint8Array): unknown {
  return JSON.parse(new TextDecoder().decode(bytes), (_key, value: unknown) => {
    if (
      typeof value === 'object' &&
      value !== null &&
      Object.keys(value).length === 1 &&
      typeof (value as Record<string, unknown>)[RESERVED] === 'string'
    ) {
      return fromBase64Url((value as Record<string, string>)[RESERVED] as string);
    }
    return value;
  });
}
