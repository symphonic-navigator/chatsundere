// SPDX-License-Identifier: LGPL-3.0-only
// Scan-latency micro-benchmark (not shipped). Times a brute-force cosine scan of
// one query against N candidates for two storage formats:
//   - int8 max-abs (global): cancelling integer dot product (our production path).
//   - int4_L: zero-point k=16, dequantise each candidate to fp32 before cosine.
// Synthetic unit vectors (no model). The question it answers: does int4_L's 37%
// storage saving cost us scan speed in the brute-force regime? Run: open /bench.html.
//
// Note: per-block scale/offset are kept as fp32 here — int8 metadata only changes
// STORAGE, not scan arithmetic, so it would not affect these timings. Hot loops use
// `?? 0` (noUncheckedIndexedAccess) on both paths, so the int4/int8 ratio is fair.

const outEl = document.getElementById('out');
if (!outEl) throw new Error('missing #out');
const el: HTMLElement = outEl;
const log = (s: string) => {
  el.textContent += `${s}\n`;
};

const DIM = 768;
const BLOCK = 16;
const NBLOCKS = DIM / BLOCK;
let sink = 0; // prevents dead-code elimination of the scans

function fillUnit(buf: Float32Array, seed: number): void {
  let s = seed >>> 0;
  let norm = 0;
  for (let i = 0; i < DIM; i++) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const x = (s / 0xffffffff) * 2 - 1;
    buf[i] = x;
    norm += x * x;
  }
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < DIM; i++) buf[i] = (buf[i] ?? 0) / norm;
}

interface Int8Store {
  codes: Int8Array;
  norms: Float32Array;
}
interface Int4Store {
  codes: Int8Array;
  scales: Float32Array;
  offsets: Float32Array;
  norms: Float32Array;
}

function buildStores(n: number): { i8: Int8Store; i4: Int4Store } {
  const i8codes = new Int8Array(n * DIM);
  const i8norms = new Float32Array(n);
  const i4codes = new Int8Array(n * DIM);
  const i4scales = new Float32Array(n * NBLOCKS);
  const i4offsets = new Float32Array(n * NBLOCKS);
  const i4norms = new Float32Array(n);
  const v = new Float32Array(DIM);

  for (let r = 0; r < n; r++) {
    fillUnit(v, r + 1);
    const base = r * DIM;

    let maxAbs = 0;
    for (let i = 0; i < DIM; i++) {
      const a = Math.abs(v[i] ?? 0);
      if (a > maxAbs) maxAbs = a;
    }
    const s8 = maxAbs > 0 ? maxAbs / 127 : 0;
    let n8 = 0;
    for (let i = 0; i < DIM; i++) {
      let q = s8 > 0 ? Math.round((v[i] ?? 0) / s8) : 0;
      if (q > 127) q = 127;
      else if (q < -127) q = -127;
      i8codes[base + i] = q;
      n8 += q * q;
    }
    i8norms[r] = Math.sqrt(n8);

    let n4 = 0;
    for (let b = 0; b < NBLOCKS; b++) {
      const start = b * BLOCK;
      let mn = Number.POSITIVE_INFINITY;
      let mx = Number.NEGATIVE_INFINITY;
      for (let i = start; i < start + BLOCK; i++) {
        const x = v[i] ?? 0;
        if (x < mn) mn = x;
        if (x > mx) mx = x;
      }
      const sc = mx > mn ? (mx - mn) / 15 : 0;
      i4scales[r * NBLOCKS + b] = sc;
      i4offsets[r * NBLOCKS + b] = mn;
      for (let i = start; i < start + BLOCK; i++) {
        let q = sc > 0 ? Math.round(((v[i] ?? 0) - mn) / sc) : 0;
        if (q > 15) q = 15;
        else if (q < 0) q = 0;
        i4codes[base + i] = q;
        const val = q * sc + mn;
        n4 += val * val;
      }
    }
    i4norms[r] = Math.sqrt(n4);
  }

  return {
    i8: { codes: i8codes, norms: i8norms },
    i4: { codes: i4codes, scales: i4scales, offsets: i4offsets, norms: i4norms },
  };
}

function scanInt8(store: Int8Store, q: Int8Array, qNorm: number, n: number): number {
  const { codes, norms } = store;
  let best = -2;
  for (let r = 0; r < n; r++) {
    const base = r * DIM;
    let dot = 0;
    for (let i = 0; i < DIM; i++) dot += (q[i] ?? 0) * (codes[base + i] ?? 0);
    const c = dot / (qNorm * (norms[r] ?? 1));
    if (c > best) best = c;
  }
  return best;
}

function scanInt4(store: Int4Store, qf: Float32Array, qNorm: number, n: number): number {
  const { codes, scales, offsets, norms } = store;
  let best = -2;
  for (let r = 0; r < n; r++) {
    const base = r * DIM;
    const sb = r * NBLOCKS;
    let dot = 0;
    for (let b = 0; b < NBLOCKS; b++) {
      const sc = scales[sb + b] ?? 0;
      const off = offsets[sb + b] ?? 0;
      const cbase = base + b * BLOCK;
      for (let i = 0; i < BLOCK; i++) {
        const val = (codes[cbase + i] ?? 0) * sc + off;
        dot += (qf[cbase + i] ?? 0) * val;
      }
    }
    const c = dot / (qNorm * (norms[r] ?? 1));
    if (c > best) best = c;
  }
  return best;
}

function median(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted[mid] ?? 0;
}

function benchOne(n: number, runs: number): void {
  const { i8, i4 } = buildStores(n);

  const qv = new Float32Array(DIM);
  fillUnit(qv, 0xabcdef);
  let qMax = 0;
  for (let i = 0; i < DIM; i++) {
    const a = Math.abs(qv[i] ?? 0);
    if (a > qMax) qMax = a;
  }
  const qs8 = qMax > 0 ? qMax / 127 : 0;
  const q8 = new Int8Array(DIM);
  let q8n = 0;
  for (let i = 0; i < DIM; i++) {
    let q = qs8 > 0 ? Math.round((qv[i] ?? 0) / qs8) : 0;
    if (q > 127) q = 127;
    else if (q < -127) q = -127;
    q8[i] = q;
    q8n += q * q;
  }
  const q8norm = Math.sqrt(q8n);
  let qfn = 0;
  for (let i = 0; i < DIM; i++) qfn += (qv[i] ?? 0) * (qv[i] ?? 0);
  const qfnorm = Math.sqrt(qfn);

  // warm up
  sink += scanInt8(i8, q8, q8norm, n);
  sink += scanInt4(i4, qv, qfnorm, n);

  const t8: number[] = [];
  const t4: number[] = [];
  for (let k = 0; k < runs; k++) {
    let t = performance.now();
    sink += scanInt8(i8, q8, q8norm, n);
    t8.push(performance.now() - t);
    t = performance.now();
    sink += scanInt4(i4, qv, qfnorm, n);
    t4.push(performance.now() - t);
  }
  const m8 = median(t8);
  const m4 = median(t4);
  const i8MB = ((n * 772) / 1e6).toFixed(1);
  const i4MB = ((n * 488) / 1e6).toFixed(1);
  log(
    `N=${n.toLocaleString()}  int8 ${m8.toFixed(1)} ms (${((m8 / n) * 1000).toFixed(3)} µs/vec, ${i8MB} MB) · int4_L ${m4.toFixed(1)} ms (${((m4 / n) * 1000).toFixed(3)} µs/vec, ${i4MB} MB) · int4_L is ${(m4 / m8).toFixed(2)}× slower`,
  );
}

function main(): void {
  el.textContent = 'scan benchmark (median of 5 runs, one query vs N candidates)\n';
  log(
    `dim=${DIM} · int8=772 B/vec (cancelling integer dot) · int4_L=488 B/vec (dequant per candidate)\n`,
  );
  for (const n of [10000, 50000, 100000]) {
    try {
      benchOne(n, 5);
    } catch (e) {
      log(`N=${n}: skipped (${e instanceof Error ? e.message : String(e)})`);
    }
  }
  log(`\n(checksum ${sink.toFixed(3)})`);
  log('✅ done');
}

main();
