// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import {
  BASS_GAIN,
  TREBLE_GAIN,
  applySpectralTilt,
  tiltGain,
} from '../../src/lib/voice/visualiser-tilt.js';

describe('tiltGain', () => {
  it('returns BASS_GAIN at the bass end and TREBLE_GAIN at the treble end', () => {
    const n = 24;
    expect(tiltGain(0, n)).toBeCloseTo(BASS_GAIN, 6);
    expect(tiltGain(n - 1, n)).toBeCloseTo(TREBLE_GAIN, 6);
  });

  it('rises monotonically from bass to treble', () => {
    const n = 32;
    let prev = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < n; i++) {
      const g = tiltGain(i, n);
      expect(g).toBeGreaterThan(prev);
      prev = g;
    }
  });

  it('is a constant ratio per step (exponential interpolation = constant dB slope)', () => {
    const n = 16;
    const r0 = tiltGain(1, n) / tiltGain(0, n);
    const r1 = tiltGain(10, n) / tiltGain(9, n);
    expect(r1).toBeCloseTo(r0, 6);
  });

  it('falls back to BASS_GAIN for a single bar', () => {
    expect(tiltGain(0, 1)).toBe(BASS_GAIN);
  });
});

describe('applySpectralTilt', () => {
  it('attenuates the bass and lifts the treble', () => {
    const bins = new Float32Array(24).fill(1);
    applySpectralTilt(bins);
    // Bass bar pulled down (BASS_GAIN < 1), treble bar boosted-then-clamped to 1.
    expect(bins[0]).toBeCloseTo(BASS_GAIN, 6);
    expect(bins[bins.length - 1]).toBe(1);
  });

  it('clamps every result to [0, 1]', () => {
    const bins = new Float32Array([1, 0.8, 0.5, 0.3, 0.2]);
    applySpectralTilt(bins);
    for (const v of bins) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('leaves an all-zero field at zero', () => {
    const bins = new Float32Array(16);
    applySpectralTilt(bins);
    for (const v of bins) expect(v).toBe(0);
  });
});
