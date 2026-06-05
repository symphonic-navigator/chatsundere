// SPDX-License-Identifier: LGPL-3.0-only
// One-off quantisation experiment (not shipped). Measures, on real arctic-embed
// vectors, how several int4 schemes distort similarity vs the fp32 reference —
// both as raw cosine deltas AND as ranking impact (recall@10). Schemes:
// max-abs, zero-point (min/max), mean-centred, and an MSE-optimal clipped
// zero-point. Run: `pnpm --filter embeddings dev`, open /experiment.html.
//
// Method: for each scheme we dequantise every vector and measure
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

// ---- quantisation schemes (pure) ----

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

/** Asymmetric (zero-point) using the block's raw min/max. */
function quantAsymmetric(v: Float32Array, bits: number, blockSize: number): Float32Array {
  const levels = (1 << bits) - 1; // 15 codes (0..15) for 4-bit
  const bs = blockSize > 0 ? blockSize : v.length;
  const result = new Float32Array(v.length);
  for (let start = 0; start < v.length; start += bs) {
    const end = Math.min(start + bs, v.length);
    let mn = Number.POSITIVE_INFINITY;
    let mx = Number.NEGATIVE_INFINITY;
    for (let i = start; i < end; i++) {
      const x = v[i] ?? 0;
      if (x < mn) mn = x;
      if (x > mx) mx = x;
    }
    const scale = mx > mn ? (mx - mn) / levels : 0;
    for (let i = start; i < end; i++) {
      if (scale === 0) {
        result[i] = mn;
        continue;
      }
      let q = Math.round(((v[i] ?? 0) - mn) / scale);
      if (q > levels) q = levels;
      else if (q < 0) q = 0;
      result[i] = q * scale + mn;
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

// MSE-optimal asymmetric: shrink the [min, max] range toward the block mean by a
// factor f (clipping outliers), picking the f that minimises reconstruction MSE —
// a distribution-weighted scale rather than raw min/max.
const CLIP_FACTORS = [1.0, 0.95, 0.9, 0.85, 0.8, 0.75, 0.7];

function quantAsymMSE(v: Float32Array, bits: number, blockSize: number): Float32Array {
  const levels = (1 << bits) - 1;
  const bs = blockSize > 0 ? blockSize : v.length;
  const result = new Float32Array(v.length);
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
    const mean = sum / (end - start);
    let bestLo = mn;
    let bestScale = mx > mn ? (mx - mn) / levels : 0;
    let bestErr = Number.POSITIVE_INFINITY;
    for (const f of CLIP_FACTORS) {
      const lo = mean + f * (mn - mean);
      const hi = mean + f * (mx - mean);
      const scale = hi > lo ? (hi - lo) / levels : 0;
      let err = 0;
      for (let i = start; i < end; i++) {
        const x = v[i] ?? 0;
        let dq = lo;
        if (scale > 0) {
          let q = Math.round((x - lo) / scale);
          if (q > levels) q = levels;
          else if (q < 0) q = 0;
          dq = q * scale + lo;
        }
        const e = x - dq;
        err += e * e;
      }
      if (err < bestErr) {
        bestErr = err;
        bestLo = lo;
        bestScale = scale;
      }
    }
    for (let i = start; i < end; i++) {
      if (bestScale === 0) {
        result[i] = bestLo;
        continue;
      }
      let q = Math.round(((v[i] ?? 0) - bestLo) / bestScale);
      if (q > levels) q = levels;
      else if (q < 0) q = 0;
      result[i] = q * bestScale + bestLo;
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
}

function dequantise(v: Float32Array, s: Scheme): Float32Array {
  if (s.kind === 'maxabs') return quantSymmetric(v, s.bits, s.block);
  if (s.kind === 'zeropoint') return quantAsymmetric(v, s.bits, s.block);
  if (s.kind === 'meancentre') return quantMeanCentred(v, s.bits, s.block);
  return quantAsymMSE(v, s.bits, s.block);
}

/** Stored bytes per vector: packed codes + per-block params (scale, plus an offset unless max-abs). */
function bytesPerVector(dim: number, s: Scheme): number {
  const dataBytes = Math.ceil((dim * s.bits) / 8);
  const nBlocks = s.block > 0 ? Math.ceil(dim / s.block) : 1;
  const paramsPerBlock = s.kind === 'maxabs' ? 4 : 8; // fp32 scale (+ fp32 offset)
  return dataBytes + nBlocks * paramsPerBlock;
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
  // weighting probes, all at k=32 for a fair compare against zero-point k=32:
  { name: 'int4 mean-centre k=32', bits: 4, block: 32, kind: 'meancentre' },
  { name: 'int4 zero-pt+MSE-clip k=32', bits: 4, block: 32, kind: 'asym-mse' },
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

  // fp32 reference: pair cosines + per-query top-K neighbour sets.
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
    `${pad('scheme', 30)}${pad('bits', 5)}${pad('B/vec', 7)}${pad('mean|Δ|', 10)}${pad('p95|Δ|', 10)}${pad('max|Δ|', 10)}recall@${TOP_K}`,
  );
  log('-'.repeat(82));

  for (const s of SCHEMES) {
    const dq = clean.map((v) => (v ? dequantise(v, s) : undefined));

    // (a) raw cosine deltas over all pairs.
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

    // (b) recall@K: does the scheme's top-K match fp32's?
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
      `${pad(s.name, 30)}${pad(String(s.bits), 5)}${pad(String(bytesPerVector(dim, s)), 7)}${pad(mean.toFixed(5), 10)}${pad(p95.toFixed(5), 10)}${pad(max.toFixed(5), 10)}${(recall * 100).toFixed(1)}%`,
    );
  }

  engine.dispose();
  log('\n✅ experiment complete');
}

main().catch((e) => log(`\n❌ ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`));
