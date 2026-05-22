// SPDX-License-Identifier: AGPL-3.0-only

import { loadEnv } from '../env.js';

// RFC 4648 §6 Base32 alphabet minus the four ambiguous characters
// {0 (zero), O (oh), 1 (one), I (eye)}. 32 entries; each character carries
// exactly 5 bits of entropy. A 10-character code therefore carries 50 bits.
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

// Validates the canonical display format: AAAAA-BBBBB. Both halves must use
// only the ambiguity-removed alphabet and be uppercase.
const CODE_RE = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{5}$/;

let keyCache: CryptoKey | null = null;

async function getKey(): Promise<CryptoKey> {
  if (keyCache) return keyCache;
  const env = loadEnv();
  const raw = Buffer.from(env.HMAC_KEY_PENDING_CODES, 'base64url');
  keyCache = await crypto.subtle.importKey('raw', raw, { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  return keyCache;
}

/**
 * Generates a 10-character code formatted as AAAAA-BBBBB. Each character is
 * drawn uniformly from a 32-symbol ambiguity-removed Base32 alphabet, so the
 * total entropy is 50 bits — calibrated against online brute-force given the
 * single-use atomic enforcement and the per-IP rate limits in the
 * cross-device-identity spec.
 *
 * The modulo operation `b % 32` is unbiased because 256 / 32 = 8 exactly, so
 * each alphabet character is equally likely for every random byte.
 */
export function generateCode(): string {
  const buf = new Uint8Array(10);
  crypto.getRandomValues(buf);
  // String.charAt always returns string (never undefined); b % 32 is always
  // 0–31, which is within the 32-character ALPHABET range.
  const chars = Array.from(buf, (b) => ALPHABET.charAt(b % 32));
  return `${chars.slice(0, 5).join('')}-${chars.slice(5, 10).join('')}`;
}

/**
 * Returns the HMAC-SHA-256 digest of the code, keyed by
 * HMAC_KEY_PENDING_CODES. The digest is what gets stored in the
 * pending_codes.code_hmac column; the plaintext code is never persisted.
 *
 * The HMAC key is deliberately distinct from INVITATION_HMAC_KEY and
 * REFRESH_TOKEN_HMAC_KEY for leak-domain isolation: a code-handling bug that
 * exposes the pending-codes key cannot compromise refresh tokens, and vice
 * versa.
 */
export async function hashCode(code: string): Promise<Uint8Array> {
  const key = await getKey();
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(code));
  return new Uint8Array(sig);
}

/**
 * Lightweight format check used before any DB lookup. Catches malformed input
 * cheaply so a join attempt with a fundamentally invalid code never hits the
 * pending_codes table or the rate-limit counter.
 */
export function isValidCodeFormat(code: string): boolean {
  return CODE_RE.test(code);
}
