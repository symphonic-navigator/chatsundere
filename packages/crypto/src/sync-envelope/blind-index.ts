// SPDX-License-Identifier: LGPL-3.0-only

import { deriveDek } from '../dek.js';
import type { MasterKey } from '../types.js';

const CONTEXT = 'sync/blind-index-v1';
const SEPARATOR = 0x00;
const BLIND_ID_BYTES = 16;

/**
 * Deterministic 16-byte blind index for a record:
 * `HMAC-SHA256(deriveDek(mk, 'sync/blind-index-v1'), collection || 0x00 || key)`
 * truncated to 128 bits. Same entity → same id on every device of the account,
 * so upserts stay idempotent; the uuidv7 never leaves the device in cleartext.
 */
export async function computeBlindId(
  mk: MasterKey,
  collection: string,
  key: string,
): Promise<Uint8Array> {
  const dek = await deriveDek(mk, CONTEXT);
  const enc = new TextEncoder();
  const c = enc.encode(collection);
  const k = enc.encode(key);
  const input = new Uint8Array(c.length + 1 + k.length);
  input.set(c, 0);
  input[c.length] = SEPARATOR;
  input.set(k, c.length + 1);
  const hmacKey = await globalThis.crypto.subtle.importKey(
    'raw',
    dek as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = new Uint8Array(await globalThis.crypto.subtle.sign('HMAC', hmacKey, input as BufferSource));
  return mac.slice(0, BLIND_ID_BYTES);
}
