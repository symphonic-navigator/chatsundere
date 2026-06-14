// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { NOISE_AMP, NOISE_BASELINE, fillNoiseBins } from '../../src/lib/voice/visualiser-noise.js';

describe('fillNoiseBins', () => {
  it('is deterministic for a given time', () => {
    const a = new Float32Array(24);
    const b = new Float32Array(24);
    fillNoiseBins(a, 1.234);
    fillNoiseBins(b, 1.234);
    expect(Array.from(a)).toEqual(Array.from(b));
  });
  it('stays within [BASELINE, BASELINE + AMP]', () => {
    const out = new Float32Array(48);
    for (let t = 0; t < 10; t += 0.137) {
      fillNoiseBins(out, t);
      for (const v of out) {
        expect(v).toBeGreaterThanOrEqual(NOISE_BASELINE - 1e-9);
        expect(v).toBeLessThanOrEqual(NOISE_BASELINE + NOISE_AMP + 1e-9);
      }
    }
  });
});
