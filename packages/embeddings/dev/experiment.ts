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
  // smaller blocks (k=16) — finer local fit, with the metadata axis:
  { name: 'int4 MSE-clip k=16 (meta fp32)', bits: 4, block: 16, kind: 'asym-mse', meta: 32 },
  { name: 'int4 MSE-clip k=16 (meta fp16)', bits: 4, block: 16, kind: 'asym-mse', meta: 16 },
  { name: 'int4 MSE-clip k=16 (meta int8)', bits: 4, block: 16, kind: 'asym-mse', meta: 8 },
  { name: 'int4 zero-point k=16 (meta int8)', bits: 4, block: 16, kind: 'zeropoint', meta: 8 },
];

// A deliberately diverse, multilingual corpus so pair cosines span a wide range.
const CORPUS = [
  'The cat sleeps on the warm windowsill.',
  'A feline naps in a sunbeam by the glass.',
  'Quarterly revenue exceeded every forecast this year.',
  'The company posted record profits last quarter.',
  'Photosynthesis converts sunlight into chemical energy.',
  'Plants turn light into sugar inside their leaves.',
  'The orchestra tuned their instruments before the concert.',
  'A violinist rosined her bow in the wings.',
  'Mount Everest is the highest peak on Earth.',
  'The summit of Everest pierces the jet stream.',
  'She refactored the parser to remove the recursion.',
  'The compiler emits an error on the missing semicolon.',
  'Rain hammered the tin roof all through the night.',
  'A thunderstorm rolled across the dark prairie.',
  'The recipe calls for two cups of sifted flour.',
  'Knead the dough until it springs back gently.',
  'Quantum entanglement links two distant particles.',
  'Spin measurements correlate across the laboratory.',
  'The marathon runner hit the wall at mile twenty.',
  'Her legs burned over the final kilometres of the race.',
  'A black hole bends light around its event horizon.',
  'Spacetime curves steeply near a collapsed star.',
  'The toddler stacked the wooden blocks into a tower.',
  'A child giggled as the bricks tumbled down.',
  'Interest rates rose a quarter point on Wednesday.',
  'The central bank tightened policy to cool inflation.',
  'Die Katze schläft auf der warmen Fensterbank.',
  'Der Hund bellt laut im verschneiten Garten.',
  'Кошка спит на тёплом подоконнике.',
  'Собака громко лает в заснеженном дворе.',
  '猫が暖かい窓辺で眠っている。',
  '犬が雪の積もった庭で吠えている。',
  '猫在温暖的窗台上睡觉。',
  '狗在下雪的院子里大声吠叫。',
  'Le chat dort sur le rebord de la fenêtre.',
  'El gato duerme en el alféizar soleado.',
  'A train departs the platform at half past nine.',
  'Commuters crowded the rush-hour carriage.',
  'The chef plated the seared scallops with care.',
  'Steam rose from the bowl of miso soup.',
  'A glacier calved into the icy fjord at dawn.',
  'The reef shimmered with darting tropical fish.',
  'He debugged the race condition in the scheduler.',
  'The mutex prevented two threads from colliding.',
  'Lavender fields stretched purple to the horizon.',
  'Bees drifted between the blossoms in the heat.',
  'The telescope captured a faint distant galaxy.',
  'Astronomers charted a new comet near Jupiter.',
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

async function main() {
  log('creating engine…');
  const engine = await createEmbeddingEngine({ onProgress: () => {} });
  log(`backend: ${formatBackendLabel(engine.backend)}`);
  log(`corpus: ${CORPUS.length} texts → embedding…`);

  const vecs = await engine.embed(CORPUS, { kind: 'document' });
  const clean = vecs.filter((v): v is Float32Array => v !== undefined);
  const n = clean.length;
  const dim = clean[0]?.length ?? 0;
  log(`embedded ${n} vectors, dim ${dim}`);

  const pairs: Array<[Float32Array, Float32Array]> = [];
  const ref: number[] = [];
  for (let i = 0; i < n; i++) {
    const vi = clean[i];
    if (!vi) continue;
    for (let j = i + 1; j < n; j++) {
      const vj = clean[j];
      if (!vj) continue;
      pairs.push([vi, vj]);
      ref.push(cosine(vi, vj));
    }
  }
  const fp32Top: Array<Set<number>> = [];
  for (let i = 0; i < n; i++) fp32Top.push(topKNeighbours(clean, i, TOP_K));
  log(`${pairs.length} pairs · recall@${TOP_K} via leave-one-out\n`);

  log(
    `${pad('scheme', 34)}${pad('B/vec', 7)}${pad('mean|Δ|', 10)}${pad('p95|Δ|', 10)}${pad('max|Δ|', 10)}recall@${TOP_K}`,
  );
  log('-'.repeat(81));

  for (const s of SCHEMES) {
    const dq = clean.map((v) => (v ? dequantise(v, s) : undefined));

    const deltas: number[] = [];
    let p = 0;
    for (let i = 0; i < n; i++) {
      if (!clean[i]) continue;
      for (let j = i + 1; j < n; j++) {
        if (!clean[j]) continue;
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

    let recallSum = 0;
    let queries = 0;
    for (let i = 0; i < n; i++) {
      if (!dq[i]) continue;
      const top = topKNeighbours(dq, i, TOP_K);
      const truth = fp32Top[i];
      if (!truth || truth.size === 0) continue;
      let hit = 0;
      for (const idx of top) if (truth.has(idx)) hit++;
      recallSum += hit / truth.size;
      queries++;
    }
    const recall = recallSum / Math.max(1, queries);

    log(
      `${pad(s.name, 34)}${pad(String(bytesPerVector(dim, s)), 7)}${pad(mean.toFixed(5), 10)}${pad(p95.toFixed(5), 10)}${pad(max.toFixed(5), 10)}${(recall * 100).toFixed(1)}%`,
    );
  }

  engine.dispose();
  log('\n✅ experiment complete');
}

main().catch((e) => log(`\n❌ ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`));
