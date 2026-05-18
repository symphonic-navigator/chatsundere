// SPDX-License-Identifier: LGPL-3.0-only

/**
 * Constant-time comparison of two byte buffers. Returns false if the
 * lengths differ (the length difference itself is allowed to leak, as in
 * every comparable implementation). Use this for any comparison of secret
 * material that is not already protected by an AEAD authentication tag.
 */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= (a[i] as number) ^ (b[i] as number);
  }
  return diff === 0;
}
