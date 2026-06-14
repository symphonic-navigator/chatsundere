// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import {
  FREQ_MAX_HZ,
  FREQ_MIN_HZ,
  bucketIntoLogBins,
} from '../../src/lib/voice/visualiser-bucketing.js';

describe('bucketIntoLogBins', () => {
  it('returns one normalised value per output bin', () => {
    const raw = new Uint8Array(128).fill(255);
    const out = bucketIntoLogBins(raw, 24_000, 256, 24);
    expect(out.length).toBe(24);
    for (const v of out) expect(v).toBeGreaterThanOrEqual(0);
    for (const v of out) expect(v).toBeLessThanOrEqual(1);
  });
  it('maps a full-scale FFT to ~1.0 across all bars', () => {
    const raw = new Uint8Array(128).fill(255);
    const out = bucketIntoLogBins(raw, 24_000, 256, 24);
    for (const v of out) expect(v).toBeCloseTo(1, 5);
  });
  it('maps a zero FFT to 0 across all bars', () => {
    const raw = new Uint8Array(128).fill(0);
    const out = bucketIntoLogBins(raw, 24_000, 256, 24);
    for (const v of out) expect(v).toBe(0);
  });
  it('exposes the documented frequency span', () => {
    expect(FREQ_MIN_HZ).toBe(20);
    expect(FREQ_MAX_HZ).toBe(12_000);
  });
});
