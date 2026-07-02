// SPDX-License-Identifier: LGPL-3.0-only

import { CryptoError } from '../errors.js';

const MIN_BUCKET = 1024;
const CAP = 1_048_576; // 1 MiB — buckets stop doubling here (spec §5.3)
const STEP_ABOVE_CAP = 262_144; // 256 KiB

function bucketFor(total: number): number {
  if (total <= CAP) {
    let b = MIN_BUCKET;
    while (b < total) b *= 2;
    return b;
  }
  return Math.ceil(total / STEP_ABOVE_CAP) * STEP_ABOVE_CAP;
}

/** Frames `encoded` with a u32-LE length prefix; zero-pads to the §5.3 bucket when `padded`. */
export function padPlaintext(encoded: Uint8Array, padded: boolean): Uint8Array {
  const total = 4 + encoded.length;
  const target = padded ? bucketFor(total) : total;
  const out = new Uint8Array(target);
  new DataView(out.buffer).setUint32(0, encoded.length, true);
  out.set(encoded, 4);
  return out;
}

/** Inverts {@link padPlaintext}. Throws on an impossible length prefix. */
export function unpadPlaintext(framed: Uint8Array): Uint8Array {
  if (framed.length < 4) throw new CryptoError('corrupted_data', 'framed plaintext too short');
  const len = new DataView(framed.buffer, framed.byteOffset).getUint32(0, true);
  if (4 + len > framed.length)
    throw new CryptoError('corrupted_data', 'invalid plaintext length prefix');
  return framed.slice(4, 4 + len);
}
