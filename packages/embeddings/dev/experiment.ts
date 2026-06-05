// SPDX-License-Identifier: LGPL-3.0-only
// One-off quantisation experiment (not shipped). Compares the cosine-similarity
// deltas of several int4 schemes (max-abs, k-block, zero-point) against the fp32
// reference, on real arctic-embed vectors. Run: `pnpm --filter embeddings dev`
// then open /experiment.html.
//
// Method: for each scheme we dequantise every vector and measure
// |cosine_scheme − cosine_fp32| over all corpus pairs — a fair, scheme-agnostic
// apples-to-apples comparison of how much the stored representation distorts
// similarity. (Our production int8 uses the equivalent scale-cancelling integer
// path; here we dequantise uniformly so every scheme is measured the same way.)
import { createEmbeddingEngine, formatBackendLabel } from '../src/index.js';

const outEl = document.getElementById('out');
if (!outEl) throw new Error('missing #out element');
const el: HTMLElement = outEl;
const log = (s: string) => {
  el.textContent += `${s}\n`;
};

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

/** Asymmetric (zero-point) to `bits` bits; per block a min and a scale. */
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
  zeroPoint: boolean;
}

function dequantise(v: Float32Array, s: Scheme): Float32Array {
  return s.zeroPoint ? quantAsymmetric(v, s.bits, s.block) : quantSymmetric(v, s.bits, s.block);
}

/** Stored bytes per vector: packed codes + per-block params (scale, plus min for zero-point). */
function bytesPerVector(dim: number, s: Scheme): number {
  const dataBytes = Math.ceil((dim * s.bits) / 8);
  const nBlocks = s.block > 0 ? Math.ceil(dim / s.block) : 1;
  const paramsPerBlock = s.zeroPoint ? 8 : 4; // fp32 scale (+ fp32 min)
  return dataBytes + nBlocks * paramsPerBlock;
}

const SCHEMES: Scheme[] = [
  { name: 'int8 max-abs (global) [prod]', bits: 8, block: 0, zeroPoint: false },
  { name: 'int4 max-abs (global)', bits: 4, block: 0, zeroPoint: false },
  { name: 'int4 zero-point (global)', bits: 4, block: 0, zeroPoint: true },
  { name: 'int4 max-abs k-block=64', bits: 4, block: 64, zeroPoint: false },
  { name: 'int4 max-abs k-block=32', bits: 4, block: 32, zeroPoint: false },
  { name: 'int4 max-abs k-block=16', bits: 4, block: 16, zeroPoint: false },
  { name: 'int4 zero-point k-block=64', bits: 4, block: 64, zeroPoint: true },
  { name: 'int4 zero-point k-block=32', bits: 4, block: 32, zeroPoint: true },
  { name: 'int4 zero-point k-block=16', bits: 4, block: 16, zeroPoint: true },
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

function pad(s: string, n: number): string {
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

async function main() {
  log('creating engine…');
  const engine = await createEmbeddingEngine({ onProgress: () => {} });
  log(`backend: ${formatBackendLabel(engine.backend)}`);
  log(`corpus: ${CORPUS.length} texts → embedding…`);

  const vecs = await engine.embed(CORPUS, { kind: 'document' });
  const clean = vecs.filter((v): v is Float32Array => v !== undefined);
  const dim = clean[0]?.length ?? 0;
  log(`embedded ${clean.length} vectors, dim ${dim}`);

  // fp32 reference cosines for every unordered pair.
  const pairs: Array<[Float32Array, Float32Array]> = [];
  const ref: number[] = [];
  for (let i = 0; i < clean.length; i++) {
    const vi = clean[i];
    if (!vi) continue;
    for (let j = i + 1; j < clean.length; j++) {
      const vj = clean[j];
      if (!vj) continue;
      pairs.push([vi, vj]);
      ref.push(cosine(vi, vj));
    }
  }
  log(`${pairs.length} pairs · method: dequantise → cosine → |Δ| vs fp32\n`);

  log(
    `${pad('scheme', 30)}${pad('bits', 5)}${pad('B/vec', 7)}${pad('mean|Δ|', 10)}${pad('p95|Δ|', 10)}max|Δ|`,
  );
  log('-'.repeat(72));

  for (const s of SCHEMES) {
    // Map each pair's vectors through the scheme, then measure the cosine delta.
    const deltas: number[] = [];
    for (let p = 0; p < pairs.length; p++) {
      const pair = pairs[p];
      if (!pair) continue;
      const a = dequantise(pair[0], s);
      const b = dequantise(pair[1], s);
      deltas.push(Math.abs(cosine(a, b) - (ref[p] ?? 0)));
    }
    deltas.sort((x, y) => x - y);
    const mean = deltas.reduce((acc, d) => acc + d, 0) / Math.max(1, deltas.length);
    const p95 = deltas[Math.floor(deltas.length * 0.95)] ?? 0;
    const max = deltas[deltas.length - 1] ?? 0;
    log(
      `${pad(s.name, 30)}${pad(String(s.bits), 5)}${pad(String(bytesPerVector(dim, s)), 7)}${pad(mean.toFixed(5), 10)}${pad(p95.toFixed(5), 10)}${max.toFixed(5)}`,
    );
  }

  engine.dispose();
  log('\n✅ experiment complete');
}

main().catch((e) => log(`\n❌ ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`));
