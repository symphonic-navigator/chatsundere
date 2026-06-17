// SPDX-License-Identifier: AGPL-3.0-only

/**
 * A diffuse reverb tail is, at heart, thousands of overlapping reflections —
 * mathematically close to exponentially-decaying noise. We synthesise the
 * impulse response rather than ship a measured one: for the inner monologue's
 * deliberately "no real room" character this is more fitting than any real hall.
 */

/** Deterministic [-1, 1) noise from an integer state (mulberry32-style). Pure. */
function nextNoise(state: number): { value: number; state: number } {
  let t = (state + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const u = ((t ^ (t >>> 14)) >>> 0) / 0xffffffff; // [0, 1]
  return { value: u * 2 - 1, state: t | 0 };
}

/**
 * Fill `out` with exponentially-decaying noise: out[i] = noise * (1 - i/N)^decay.
 * `seed` selects the deterministic noise sequence so stereo channels differ.
 */
export function fillImpulseChannel(
  out: Float32Array,
  _sampleRate: number,
  decay: number,
  seed: number,
): void {
  const n = out.length;
  let state = seed | 0;
  for (let i = 0; i < n; i++) {
    const step = nextNoise(state);
    state = step.state;
    const envelope = (1 - i / n) ** decay;
    out[i] = step.value * envelope;
  }
}

/**
 * Build a stereo procedural impulse response for the monologue convolver.
 * `durationS` is the tail length; `decay` shapes the envelope steepness.
 */
export function buildMonologueImpulse(
  ctx: BaseAudioContext,
  durationS = 1.6,
  decay = 2.5,
): AudioBuffer {
  const sampleRate = ctx.sampleRate;
  const length = Math.max(1, Math.floor(sampleRate * durationS));
  const buffer = ctx.createBuffer(2, length, sampleRate);
  fillImpulseChannel(buffer.getChannelData(0), sampleRate, decay, 1);
  fillImpulseChannel(buffer.getChannelData(1), sampleRate, decay, 2);
  return buffer;
}
