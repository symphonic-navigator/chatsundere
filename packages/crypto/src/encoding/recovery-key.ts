// SPDX-License-Identifier: LGPL-3.0-only

import { CryptoError } from '../errors.js';
import { type RecoveryKey, asRecoveryKey } from '../types.js';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CHECKSUM_ALPHABET = `${ALPHABET}*~$=U`;
const SUBSTITUTIONS: Record<string, string> = {
  O: '0',
  I: '1',
  L: '1',
  o: '0',
  i: '1',
  l: '1',
};

/** Encode a 32-byte RecoveryKey as a Crockford-base32 string with checksum. */
export function encodeRecoveryKey(key: RecoveryKey): string {
  if (key.length !== 32) {
    throw new CryptoError('internal', 'RecoveryKey must be 32 bytes');
  }
  const bits = bytesToBits(key);
  let body = '';
  for (let i = 0; i < bits.length; i += 5) {
    const chunk = bits.slice(i, i + 5).padEnd(5, '0');
    body += ALPHABET[Number.parseInt(chunk, 2)];
  }
  const checksum = computeChecksum(key);
  const full = `${body}${CHECKSUM_ALPHABET[checksum]}`;
  return groupInFours(full);
}

/** Decode a Crockford-base32 string into a 32-byte RecoveryKey. Verifies checksum. */
export function decodeRecoveryKey(input: string): RecoveryKey {
  const cleaned = stripAndNormalise(input);
  if (cleaned.length !== 53) {
    throw new CryptoError('invalid_recovery_key_format', 'Recovery key has unexpected length');
  }
  const body = cleaned.slice(0, 52);
  const checksumChar = cleaned[52] as string;
  let bits = '';
  for (const ch of body) {
    const idx = ALPHABET.indexOf(ch);
    if (idx === -1) {
      throw new CryptoError(
        'invalid_recovery_key_format',
        'Recovery key contains invalid characters',
      );
    }
    bits += idx.toString(2).padStart(5, '0');
  }
  const bytes = bitsToBytes(bits.slice(0, 256));
  const expected = computeChecksum(bytes);
  const got = CHECKSUM_ALPHABET.indexOf(checksumChar);
  if (got === -1 || got !== expected) {
    throw new CryptoError('invalid_recovery_key_format', 'Recovery key checksum mismatch');
  }
  return asRecoveryKey(bytes);
}

function stripAndNormalise(s: string): string {
  return s
    .split('')
    .map((c) => SUBSTITUTIONS[c] ?? c.toUpperCase())
    .join('')
    .replace(/[\s-]+/g, '');
}

function bytesToBits(bytes: Uint8Array): string {
  let bits = '';
  for (const b of bytes) bits += b.toString(2).padStart(8, '0');
  return bits;
}

function bitsToBytes(bits: string): Uint8Array {
  const out = new Uint8Array(bits.length / 8);
  for (let i = 0; i < out.length; i++) {
    out[i] = Number.parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  }
  return out;
}

function computeChecksum(bytes: Uint8Array): number {
  let acc = 0n;
  for (const b of bytes) acc = (acc * 256n + BigInt(b)) % 37n;
  return Number(acc);
}

function groupInFours(s: string): string {
  const out: string[] = [];
  for (let i = 0; i < s.length; i += 4) out.push(s.slice(i, i + 4));
  return out.join('-');
}
