// SPDX-License-Identifier: LGPL-3.0-only
// One-off quantisation experiment (not shipped). Measures, on real arctic-embed
// vectors, how several int4 schemes distort similarity vs the fp32 reference —
// as raw cosine deltas AND ranking impact (recall@10). Schemes: max-abs,
// zero-point (min/max), mean-centred, MSE-optimal clipped zero-point, plus a
// metadata-precision axis (store per-block scale+offset as fp32 / fp16 / int8 —
// the second level of GGUF k-quants). Run: `pnpm --filter embeddings dev`, open
// /experiment.html.
//
// Method: dequantise every vector, then measure
// (a) |cosine_scheme − cosine_fp32| over all pairs, and
// (b) recall@10: leave-one-out, does the scheme's top-10 nearest match fp32's?
import { createEmbeddingEngine, formatBackendLabel } from '../src/index.js';
import { CORPUS } from './corpus.js';

const outEl = document.getElementById('out');
if (!outEl) throw new Error('missing #out element');
const el: HTMLElement = outEl;
const log = (s: string) => {
  el.textContent += `${s}\n`;
};

type Kind = 'maxabs' | 'zeropoint' | 'meancentre' | 'asym-mse';

// ---- value quantisers ----

/** Symmetric max-abs to `bits` bits; blockSize 0 = whole vector (global scale). */
function quantSymmetric(v: Float32Array, bits: number, blockSize: number): Float32Array {
  const qmax = (1 << (bits - 1)) - 1; // 127 for 8-bit, 7 for 4-bit
  const bs = blockSize > 0 ? blockSize : v.length;
  const result = new Float32Array(v.length);
  for (let start = 0; start < v.length; start += bs) {
    const end = Math.min(start + bs, v.length);
    let maxAbs = 0;
    for (let i = start; i < end; i++) {
      const a = Math.abs(v[i] ?? 0);
      if (a > maxAbs) maxAbs = a;
    }
    const scale = maxAbs > 0 ? maxAbs / qmax : 0;
    for (let i = start; i < end; i++) {
      if (scale === 0) {
        result[i] = 0;
        continue;
      }
      let q = Math.round((v[i] ?? 0) / scale);
      if (q > qmax) q = qmax;
      else if (q < -qmax) q = -qmax;
      result[i] = q * scale;
    }
  }
  return result;
}

/** Mean-centred symmetric: subtract the block mean, symmetric-quantise the residual. */
function quantMeanCentred(v: Float32Array, bits: number, blockSize: number): Float32Array {
  const qmax = (1 << (bits - 1)) - 1;
  const bs = blockSize > 0 ? blockSize : v.length;
  const result = new Float32Array(v.length);
  for (let start = 0; start < v.length; start += bs) {
    const end = Math.min(start + bs, v.length);
    let sum = 0;
    for (let i = start; i < end; i++) sum += v[i] ?? 0;
    const mean = sum / (end - start);
    let maxAbs = 0;
    for (let i = start; i < end; i++) {
      const a = Math.abs((v[i] ?? 0) - mean);
      if (a > maxAbs) maxAbs = a;
    }
    const scale = maxAbs > 0 ? maxAbs / qmax : 0;
    for (let i = start; i < end; i++) {
      if (scale === 0) {
        result[i] = mean;
        continue;
      }
      let q = Math.round(((v[i] ?? 0) - mean) / scale);
      if (q > qmax) q = qmax;
      else if (q < -qmax) q = -qmax;
      result[i] = q * scale + mean;
    }
  }
  return result;
}

const CLIP_FACTORS = [1.0, 0.95, 0.9, 0.85, 0.8, 0.75, 0.7];

// ---- metadata precision (the GGUF "scale-of-scales" idea) ----

/** Round to IEEE-754 half-precision mantissa (~11 effective bits). Values here are well inside fp16's normal range. */
function fp16Round(x: number): number {
  if (!Number.isFinite(x) || x === 0) return x;
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const step = 2 ** (Math.floor(Math.log2(ax)) - 10); // 10 mantissa bits
  return sign * Math.round(ax / step) * step;
}

/** Quantise an array of params to int8 over [lo, hi], returning the dequantised values. */
function int8RoundArray(vals: number[], lo: number, hi: number): number[] {
  const span = hi - lo;
  if (span <= 0) return vals.map(() => lo);
  const step = span / 255;
  return vals.map((x) => {
    let q = Math.round((x - lo) / step);
    if (q > 255) q = 255;
    else if (q < 0) q = 0;
    return lo + q * step;
  });
}

/**
 * Asymmetric quant (zero-point or MSE-optimal clipped) with a metadata-precision
 * axis: per-block (lo, scale) computed in fp32, then optionally rounded to fp16
 * or quantised to int8 (per vector) before reconstruction.
 */
function quantAsymmetric(
  v: Float32Array,
  bits: number,
  blockSize: number,
  useMSE: boolean,
  metaBits: number,
): Float32Array {
  const levels = (1 << bits) - 1;
  const bs = blockSize > 0 ? blockSize : v.length;
  const starts: number[] = [];
  const los: number[] = [];
  const scales: number[] = [];

  for (let start = 0; start < v.length; start += bs) {
    const end = Math.min(start + bs, v.length);
    let sum = 0;
    let mn = Number.POSITIVE_INFINITY;
    let mx = Number.NEGATIVE_INFINITY;
    for (let i = start; i < end; i++) {
      const x = v[i] ?? 0;
      sum += x;
      if (x < mn) mn = x;
      if (x > mx) mx = x;
    }
    let lo = mn;
    let scale = mx > mn ? (mx - mn) / levels : 0;
    if (useMSE) {
      const mean = sum / (end - start);
      let bestErr = Number.POSITIVE_INFINITY;
      for (const f of CLIP_FACTORS) {
        const flo = mean + f * (mn - mean);
        const fhi = mean + f * (mx - mean);
        const fscale = fhi > flo ? (fhi - flo) / levels : 0;
        let err = 0;
        for (let i = start; i < end; i++) {
          const x = v[i] ?? 0;
          let dq = flo;
          if (fscale > 0) {
            let q = Math.round((x - flo) / fscale);
            if (q > levels) q = levels;
            else if (q < 0) q = 0;
            dq = q * fscale + flo;
          }
          const e = x - dq;
          err += e * e;
        }
        if (err < bestErr) {
          bestErr = err;
          lo = flo;
          scale = fscale;
        }
      }
    }
    starts.push(start);
    los.push(lo);
    scales.push(scale);
  }

  let qLos = los;
  let qScales = scales;
  if (metaBits === 16) {
    qLos = los.map(fp16Round);
    qScales = scales.map(fp16Round);
  } else if (metaBits === 8) {
    let loMin = Number.POSITIVE_INFINITY;
    let loMax = Number.NEGATIVE_INFINITY;
    let scMax = 0;
    for (const l of los) {
      if (l < loMin) loMin = l;
      if (l > loMax) loMax = l;
    }
    for (const sc of scales) if (sc > scMax) scMax = sc;
    qLos = int8RoundArray(los, loMin, loMax);
    qScales = int8RoundArray(scales, 0, scMax);
  }

  const result = new Float32Array(v.length);
  for (let b = 0; b < starts.length; b++) {
    const start = starts[b] ?? 0;
    const end = Math.min(start + bs, v.length);
    const lo = qLos[b] ?? 0;
    const scale = qScales[b] ?? 0;
    for (let i = start; i < end; i++) {
      if (scale === 0) {
        result[i] = lo;
        continue;
      }
      let q = Math.round(((v[i] ?? 0) - lo) / scale);
      if (q > levels) q = levels;
      else if (q < 0) q = 0;
      result[i] = q * scale + lo;
    }
  }
  return result;
}

function cosine(a: Float32Array, b: Float32Array): number {
  let d = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    d += x * y;
    na += x * x;
    nb += y * y;
  }
  const den = Math.sqrt(na) * Math.sqrt(nb);
  return den === 0 ? 0 : d / den;
}

interface Scheme {
  name: string;
  bits: number;
  block: number; // 0 = global
  kind: Kind;
  meta?: number; // metadata precision in bits: 32 (default) | 16 | 8
}

function dequantise(v: Float32Array, s: Scheme): Float32Array {
  if (s.kind === 'maxabs') return quantSymmetric(v, s.bits, s.block);
  if (s.kind === 'meancentre') return quantMeanCentred(v, s.bits, s.block);
  return quantAsymmetric(v, s.bits, s.block, s.kind === 'asym-mse', s.meta ?? 32);
}

/** Stored bytes per vector: packed codes + per-block params (+ tiny per-vector overhead for int8 metadata). */
function bytesPerVector(dim: number, s: Scheme): number {
  const dataBytes = Math.ceil((dim * s.bits) / 8);
  const nBlocks = s.block > 0 ? Math.ceil(dim / s.block) : 1;
  if (s.kind === 'maxabs') return dataBytes + nBlocks * 4; // fp32 scale only
  const meta = s.meta ?? 32;
  const paramBytesPerBlock = meta === 32 ? 8 : meta === 16 ? 4 : 2; // 2 params × (4|2|1) B
  const vecOverhead = meta === 8 ? 8 : 0; // per-vector lo-range + scale-max
  return dataBytes + nBlocks * paramBytesPerBlock + vecOverhead;
}

const SCHEMES: Scheme[] = [
  { name: 'int8 max-abs (global) [prod]', bits: 8, block: 0, kind: 'maxabs' },
  { name: 'int4 max-abs (global)', bits: 4, block: 0, kind: 'maxabs' },
  { name: 'int4 zero-point (global)', bits: 4, block: 0, kind: 'zeropoint' },
  { name: 'int4 max-abs k=64', bits: 4, block: 64, kind: 'maxabs' },
  { name: 'int4 max-abs k=32', bits: 4, block: 32, kind: 'maxabs' },
  { name: 'int4 max-abs k=16', bits: 4, block: 16, kind: 'maxabs' },
  { name: 'int4 zero-point k=64', bits: 4, block: 64, kind: 'zeropoint' },
  { name: 'int4 zero-point k=32', bits: 4, block: 32, kind: 'zeropoint' },
  { name: 'int4 zero-point k=16', bits: 4, block: 16, kind: 'zeropoint' },
  { name: 'int4 mean-centre k=32', bits: 4, block: 32, kind: 'meancentre' },
  { name: 'int4 MSE-clip k=32 (meta fp32)', bits: 4, block: 32, kind: 'asym-mse', meta: 32 },
  // metadata-precision axis on the best int4 scheme:
  { name: 'int4 MSE-clip k=32 (meta fp16)', bits: 4, block: 32, kind: 'asym-mse', meta: 16 },
  { name: 'int4 MSE-clip k=32 (meta int8)', bits: 4, block: 32, kind: 'asym-mse', meta: 8 },
  { name: 'int4 zero-point k=32 (meta int8)', bits: 4, block: 32, kind: 'zeropoint', meta: 8 },
  // taxonomy candidates with int8 metadata throughout:
  { name: 'int4 zero-point global (meta int8)', bits: 4, block: 0, kind: 'zeropoint', meta: 8 },
  { name: 'int4 zero-point k=64 (meta int8)', bits: 4, block: 64, kind: 'zeropoint', meta: 8 },
  // smaller blocks (k=16) — finer local fit, with the metadata axis:
  { name: 'int4 MSE-clip k=16 (meta fp32)', bits: 4, block: 16, kind: 'asym-mse', meta: 32 },
  { name: 'int4 MSE-clip k=16 (meta fp16)', bits: 4, block: 16, kind: 'asym-mse', meta: 16 },
  { name: 'int4 MSE-clip k=16 (meta int8)', bits: 4, block: 16, kind: 'asym-mse', meta: 8 },
  { name: 'int4 zero-point k=16 (meta int8)', bits: 4, block: 16, kind: 'zeropoint', meta: 8 },
];

const TOP_K = 10;

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

/** Indices of the top-K nearest neighbours of vector i within `vecs` (excluding i). */
function topKNeighbours(vecs: Array<Float32Array | undefined>, i: number, k: number): Set<number> {
  const vi = vecs[i];
  if (!vi) return new Set();
  const scored: Array<{ idx: number; c: number }> = [];
  for (let j = 0; j < vecs.length; j++) {
    if (j === i) continue;
    const vj = vecs[j];
    if (!vj) continue;
    scored.push({ idx: j, c: cosine(vi, vj) });
  }
  scored.sort((a, b) => b.c - a.c);
  return new Set(scored.slice(0, k).map((s) => s.idx));
}

/** Truncate a vector to its first `d` dimensions and renormalise to unit length (Matryoshka). */
function truncateNormalise(v: Float32Array, d: number): Float32Array {
  const out = new Float32Array(d);
  let norm = 0;
  for (let i = 0; i < d; i++) {
    const x = v[i] ?? 0;
    out[i] = x;
    norm += x * x;
  }
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < d; i++) out[i] = (out[i] ?? 0) / norm;
  return out;
}

/**
 * Run the full scheme table against a set of fp32 reference vectors of some dimension.
 * `recall@K` is measured against this set's own fp32 ranking (isolates quant). If `truth`
 * is given (the full-768 fp32 top-K per query), an extra `rec/768` column reports the
 * scheme's top-K against the TRUE 768 ranking — the end-to-end quality (truncation + quant).
 */
function runTable(title: string, clean: Float32Array[], truth?: Array<Set<number>>): void {
  const numVecs = clean.length;
  const dim = clean[0]?.length ?? 0;

  const ref: number[] = [];
  for (let i = 0; i < numVecs; i++) {
    const vi = clean[i];
    if (!vi) continue;
    for (let j = i + 1; j < numVecs; j++) {
      const vj = clean[j];
      if (!vj) continue;
      ref.push(cosine(vi, vj));
    }
  }
  const localTop: Array<Set<number>> = [];
  for (let i = 0; i < numVecs; i++) localTop.push(topKNeighbours(clean, i, TOP_K));

  log(`\n=== ${title} · ${dim}-dim · ${numVecs} vecs · ${ref.length} pairs ===`);
  const recHead = truth ? `${pad(`rec/${dim}`, 9)}rec/768` : `recall@${TOP_K}`;
  log(
    `${pad('scheme', 34)}${pad('B/vec', 7)}${pad('mean|Δ|', 10)}${pad('p95|Δ|', 10)}${pad('max|Δ|', 10)}${recHead}`,
  );
  log('-'.repeat(truth ? 88 : 81));

  for (const s of SCHEMES) {
    const dq = clean.map((v) => dequantise(v, s));

    const deltas: number[] = [];
    let p = 0;
    for (let i = 0; i < numVecs; i++) {
      for (let j = i + 1; j < numVecs; j++) {
        const a = dq[i];
        const b = dq[j];
        if (a && b) deltas.push(Math.abs(cosine(a, b) - (ref[p] ?? 0)));
        p++;
      }
    }
    deltas.sort((x, y) => x - y);
    const mean = deltas.reduce((acc, d) => acc + d, 0) / Math.max(1, deltas.length);
    const p95 = deltas[Math.floor(deltas.length * 0.95)] ?? 0;
    const max = deltas[deltas.length - 1] ?? 0;

    let localSum = 0;
    let truthSum = 0;
    let queries = 0;
    for (let i = 0; i < numVecs; i++) {
      const top = topKNeighbours(dq, i, TOP_K);
      const lt = localTop[i];
      if (!lt || lt.size === 0) continue;
      let lh = 0;
      for (const idx of top) if (lt.has(idx)) lh++;
      localSum += lh / lt.size;
      const gt = truth ? truth[i] : undefined;
      if (gt && gt.size > 0) {
        let gh = 0;
        for (const idx of top) if (gt.has(idx)) gh++;
        truthSum += gh / gt.size;
      }
      queries++;
    }
    const localRec = localSum / Math.max(1, queries);
    const truthRec = truthSum / Math.max(1, queries);

    const recCols = truth
      ? `${pad(`${(localRec * 100).toFixed(1)}%`, 9)}${(truthRec * 100).toFixed(1)}%`
      : `${(localRec * 100).toFixed(1)}%`;
    log(
      `${pad(s.name, 34)}${pad(String(bytesPerVector(dim, s)), 7)}${pad(mean.toFixed(5), 10)}${pad(p95.toFixed(5), 10)}${pad(max.toFixed(5), 10)}${recCols}`,
    );
  }
}

async function main() {
  log('creating engine…');
  const engine = await createEmbeddingEngine({ onProgress: () => {} });
  log(`backend: ${formatBackendLabel(engine.backend)}`);
  log(`corpus: ${CORPUS.length} texts → embedding…`);

  const vecs = await engine.embed(CORPUS, { kind: 'document' });
  const clean = vecs.filter((v): v is Float32Array => v !== undefined);
  log(`embedded ${clean.length} vectors, dim ${clean[0]?.length ?? 0}`);

  runTable('Full', clean);

  // Matryoshka: truncate to 256 dims + renormalise.
  const mrlDim = 256;
  const clean256 = clean.map((v) => truncateNormalise(v, mrlDim));

  // Pure truncation cost: how well does 256-dim fp32 preserve the full-768 ranking?
  const top768 = clean.map((_, i) => topKNeighbours(clean, i, TOP_K));
  const top256 = clean256.map((_, i) => topKNeighbours(clean256, i, TOP_K));
  let rSum = 0;
  let rN = 0;
  for (let i = 0; i < clean.length; i++) {
    const a = top256[i];
    const b = top768[i];
    if (!a || !b || b.size === 0) continue;
    let hit = 0;
    for (const idx of a) if (b.has(idx)) hit++;
    rSum += hit / b.size;
    rN++;
  }
  let dSum = 0;
  let dN = 0;
  for (let i = 0; i < clean.length; i++) {
    const a = clean[i];
    const a2 = clean256[i];
    if (!a || !a2) continue;
    for (let j = i + 1; j < clean.length; j++) {
      const b = clean[j];
      const b2 = clean256[j];
      if (!b || !b2) continue;
      dSum += Math.abs(cosine(a2, b2) - cosine(a, b));
      dN++;
    }
  }
  log(
    `\nMRL truncation 768→256 (fp32, no quant): recall@${TOP_K}=${((rSum / Math.max(1, rN)) * 100).toFixed(1)}% vs full · mean cosine|Δ|=${(dSum / Math.max(1, dN)).toFixed(5)}`,
  );

  runTable('Matryoshka-256', clean256, top768);

  engine.dispose();
  log('\n✅ experiment complete');
}

main().catch((e) => log(`\n❌ ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`));
