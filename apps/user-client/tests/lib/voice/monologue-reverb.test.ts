import { describe, expect, it } from 'vitest';
import { fillImpulseChannel } from '../../../src/lib/voice/monologue-reverb.js';

describe('fillImpulseChannel', () => {
  it('fills the whole buffer and stays within [-1, 1]', () => {
    const out = new Float32Array(48_000);
    fillImpulseChannel(out, 48_000, 2.5, 1);
    for (const v of out) expect(Math.abs(v)).toBeLessThanOrEqual(1);
  });

  it('decays — late energy is far below early energy', () => {
    const out = new Float32Array(48_000);
    fillImpulseChannel(out, 48_000, 2.5, 1);
    const rms = (from: number, to: number) => {
      let sum = 0;
      for (let i = from; i < to; i++) {
        const x = out[i] ?? 0;
        sum += x * x;
      }
      return Math.sqrt(sum / (to - from));
    };
    expect(rms(36_000, 48_000)).toBeLessThan(rms(0, 12_000) * 0.5);
  });

  it('is deterministic for a given seed', () => {
    const a = new Float32Array(1_000);
    const b = new Float32Array(1_000);
    fillImpulseChannel(a, 48_000, 2.5, 7);
    fillImpulseChannel(b, 48_000, 2.5, 7);
    expect(Array.from(a)).toEqual(Array.from(b));
  });
});
