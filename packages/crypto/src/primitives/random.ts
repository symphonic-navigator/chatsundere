// SPDX-License-Identifier: LGPL-3.0-only

/**
 * Wrapper around `crypto.getRandomValues` that returns a fresh Uint8Array.
 * Centralised so test seams (if ever needed) and the runtime preconditions
 * apply in one place.
 */
export function getRandomBytes(length: number): Uint8Array {
  if (!Number.isInteger(length) || length <= 0) {
    throw new Error('length must be a positive integer');
  }
  const buf = new Uint8Array(length);
  globalThis.crypto.getRandomValues(buf);
  return buf;
}
