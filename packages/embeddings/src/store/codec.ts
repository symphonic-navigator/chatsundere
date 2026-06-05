// SPDX-License-Identifier: LGPL-3.0-only
import { EMBED_DIM } from '../engine/model-config.js';

/** 1-byte format tag. Quant schemes are not transcodable in place; a future change is a re-embed migration, made detectable by this version. */
export const CODEC_VERSION = 1;
/** k=16 → 48 blocks at 768 dim. */
export const BLOCK_SIZE = 16;
/** Serialised per-vector size: 1 (version) + 4 (norm) + 12 (3× fp32 ranges) + 48 (scales) + 48 (offsets) + 384 (packed codes). */
export const I4L_VECTOR_BYTES =
  1 + 4 + 12 + (EMBED_DIM / BLOCK_SIZE) * 2 + Math.ceil(EMBED_DIM / 2);

/**
 * A vector stored as int4 zero-point with k=16 blocks and unsigned-8-bit metadata.
 * `codes` are 4-bit packed (2 per byte); per-block `scales`/`offsets` are 8-bit
 * indices into the per-vector ranges `[0, scaleMax]` and `[offMin, offMax]`
 * (the range endpoints are fp32 and may be negative). `norm` is the L2 length of
 * the DEQUANTISED reconstruction, precomputed so cosine divides by it directly.
 */
export interface EncodedVector {
  version: number;
  codes: Uint8Array;
  scales: Uint8Array;
  offsets: Uint8Array;
  scaleMax: number;
  offMin: number;
  offMax: number;
  norm: number;
}

function clampU8(x: number): number {
  if (x > 255) return 255;
  if (x < 0) return 0;
  return x;
}

/**
 * Quantise a float vector to int4 zero-point (k=16), with per-block scale/offset
 * quantised to unsigned 8-bit per vector. Codes are computed against the
 * dequantised metadata so the stored vector is self-consistent with what
 * `decode`/`cosineQuery`/sync reconstruct. Ported from the validated
 * `dev/experiment.ts` (`quantAsymmetric(v, 4, 16, false, 8)`) and `dev/bench.ts`.
 */
export function encode(v: Float32Array): EncodedVector {
  const dim = v.length;
  const nBlocks = Math.ceil(dim / BLOCK_SIZE);
  const scaleF = new Float64Array(nBlocks);
  const loF = new Float64Array(nBlocks);

  for (let b = 0; b < nBlocks; b++) {
    const start = b * BLOCK_SIZE;
    const end = Math.min(start + BLOCK_SIZE, dim);
    let mn = Number.POSITIVE_INFINITY;
    let mx = Number.NEGATIVE_INFINITY;
    for (let i = start; i < end; i++) {
      const x = v[i] ?? 0;
      if (x < mn) mn = x;
      if (x > mx) mx = x;
    }
    loF[b] = Number.isFinite(mn) ? mn : 0;
    scaleF[b] = mx > mn ? (mx - mn) / 15 : 0;
  }

  let scaleMax = 0;
  let offMin = Number.POSITIVE_INFINITY;
  let offMax = Number.NEGATIVE_INFINITY;
  for (let b = 0; b < nBlocks; b++) {
    const sc = scaleF[b] ?? 0;
    const lo = loF[b] ?? 0;
    if (sc > scaleMax) scaleMax = sc;
    if (lo < offMin) offMin = lo;
    if (lo > offMax) offMax = lo;
  }
  if (!Number.isFinite(offMin)) offMin = 0;
  if (!Number.isFinite(offMax)) offMax = 0;

  const scaleStep = scaleMax > 0 ? scaleMax / 255 : 0;
  const offSpan = offMax - offMin;
  const offStep = offSpan > 0 ? offSpan / 255 : 0;

  const scales = new Uint8Array(nBlocks);
  const offsets = new Uint8Array(nBlocks);
  for (let b = 0; b < nBlocks; b++) {
    scales[b] = scaleStep > 0 ? clampU8(Math.round((scaleF[b] ?? 0) / scaleStep)) : 0;
    offsets[b] = offStep > 0 ? clampU8(Math.round(((loF[b] ?? 0) - offMin) / offStep)) : 0;
  }

  const codes = new Uint8Array(Math.ceil(dim / 2));
  let sumSq = 0;
  for (let b = 0; b < nBlocks; b++) {
    const scaleDq = (scales[b] ?? 0) * scaleStep;
    const loDq = offMin + (offsets[b] ?? 0) * offStep;
    const start = b * BLOCK_SIZE;
    const end = Math.min(start + BLOCK_SIZE, dim);
    for (let i = start; i < end; i++) {
      let code = 0;
      if (scaleDq > 0) {
        code = Math.round(((v[i] ?? 0) - loDq) / scaleDq);
        if (code > 15) code = 15;
        else if (code < 0) code = 0;
      }
      const byte = i >> 1;
      if ((i & 1) === 0) codes[byte] = (codes[byte] ?? 0) | code;
      else codes[byte] = (codes[byte] ?? 0) | (code << 4);
      const val = code * scaleDq + loDq;
      sumSq += val * val;
    }
  }

  return {
    version: CODEC_VERSION,
    codes,
    scales,
    offsets,
    scaleMax,
    offMin,
    offMax,
    norm: Math.sqrt(sumSq),
  };
}

/** Reconstruct the approximate fp32 vector (used by the future "dreaming"/dedup consumers). */
export function decode(e: EncodedVector): Float32Array {
  const nBlocks = e.scales.length;
  const scaleStep = e.scaleMax > 0 ? e.scaleMax / 255 : 0;
  const offSpan = e.offMax - e.offMin;
  const offStep = offSpan > 0 ? offSpan / 255 : 0;
  const dim = nBlocks * BLOCK_SIZE;
  const out = new Float32Array(dim);
  for (let b = 0; b < nBlocks; b++) {
    const scaleDq = (e.scales[b] ?? 0) * scaleStep;
    const loDq = e.offMin + (e.offsets[b] ?? 0) * offStep;
    const start = b * BLOCK_SIZE;
    const end = Math.min(start + BLOCK_SIZE, out.length);
    for (let i = start; i < end; i++) {
      const byte = e.codes[i >> 1] ?? 0;
      const code = (i & 1) === 0 ? byte & 0x0f : byte >> 4;
      out[i] = code * scaleDq + loDq;
    }
  }
  return out;
}

/**
 * Serialise to the canonical little-endian wire blob (497 B). This is exactly
 * what sync will E2EE-encrypt later, so the layout is stable and versioned:
 *   [0]        version (1 B)
 *   [1..5)     norm    (fp32)
 *   [5..17)    scaleMax, offMin, offMax (3× fp32)
 *   [17..65)   48× scales  (u8)
 *   [65..113)  48× offsets (u8)
 *   [113..497) 384 B packed 4-bit codes
 * Note: norm/scaleMax/offMin/offMax are stored as fp32, so a deserialised
 * vector carries fp32-truncations of those fields (difference < 1 ULP of fp32).
 */
export function serialise(e: EncodedVector): Uint8Array {
  const nBlocks = e.scales.length;
  const buf = new Uint8Array(1 + 4 + 12 + nBlocks * 2 + e.codes.length);
  const dv = new DataView(buf.buffer);
  let o = 0;
  buf[o] = e.version;
  o += 1;
  dv.setFloat32(o, e.norm, true);
  o += 4;
  dv.setFloat32(o, e.scaleMax, true);
  o += 4;
  dv.setFloat32(o, e.offMin, true);
  o += 4;
  dv.setFloat32(o, e.offMax, true);
  o += 4;
  buf.set(e.scales, o);
  o += nBlocks;
  buf.set(e.offsets, o);
  o += nBlocks;
  buf.set(e.codes, o);
  return buf;
}

/** Reverse `serialise`. Rejects an unrecognised version byte — a future quant change is a re-embed migration. */
export function deserialise(blob: Uint8Array): EncodedVector {
  const version = blob[0] ?? 0;
  if (version !== CODEC_VERSION) {
    throw new Error(
      `Unsupported vector codec version ${version} (expected ${CODEC_VERSION}) — re-embed required.`,
    );
  }
  if (blob.byteLength !== I4L_VECTOR_BYTES) {
    throw new Error(
      `Invalid vector blob length ${blob.byteLength} (expected ${I4L_VECTOR_BYTES} bytes).`,
    );
  }
  const dv = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  let o = 1;
  const norm = dv.getFloat32(o, true);
  o += 4;
  const scaleMax = dv.getFloat32(o, true);
  o += 4;
  const offMin = dv.getFloat32(o, true);
  o += 4;
  const offMax = dv.getFloat32(o, true);
  o += 4;
  const nBlocks = EMBED_DIM / BLOCK_SIZE;
  const codesLen = Math.ceil(EMBED_DIM / 2);
  const scales = blob.slice(o, o + nBlocks);
  o += nBlocks;
  const offsets = blob.slice(o, o + nBlocks);
  o += nBlocks;
  const codes = blob.slice(o, o + codesLen);
  return { version, codes, scales, offsets, scaleMax, offMin, offMax, norm };
}

/**
 * Cosine similarity of a full-precision query against an encoded candidate.
 * The per-block scales no longer cancel (zero-point), so each candidate is
 * dequantised to fp32 before the dot product — the accepted cost from ADR 0030.
 * Ported from `dev/bench.ts` (`scanInt4`), with the int8 metadata dequantised
 * inline (which `bench.ts` notes affects storage, not scan arithmetic).
 */
export function cosineQuery(q: Float32Array, qNorm: number, e: EncodedVector): number {
  if (qNorm === 0 || e.norm === 0) return 0;
  const nBlocks = e.scales.length;
  const scaleStep = e.scaleMax > 0 ? e.scaleMax / 255 : 0;
  const offSpan = e.offMax - e.offMin;
  const offStep = offSpan > 0 ? offSpan / 255 : 0;
  let dot = 0;
  for (let b = 0; b < nBlocks; b++) {
    const scaleDq = (e.scales[b] ?? 0) * scaleStep;
    const loDq = e.offMin + (e.offsets[b] ?? 0) * offStep;
    const start = b * BLOCK_SIZE;
    const end = Math.min(start + BLOCK_SIZE, nBlocks * BLOCK_SIZE);
    for (let i = start; i < end; i++) {
      const byte = e.codes[i >> 1] ?? 0;
      const code = (i & 1) === 0 ? byte & 0x0f : byte >> 4;
      const val = code * scaleDq + loDq;
      dot += (q[i] ?? 0) * val;
    }
  }
  return dot / (qNorm * e.norm);
}
