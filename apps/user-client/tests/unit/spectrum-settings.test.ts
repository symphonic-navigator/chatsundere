import { describe, expect, it } from 'vitest';
import {
  SPECTRUM_DEFAULTS,
  clampSpectrumBarCount,
  clampSpectrumOpacity,
} from '../../src/lib/voice/spectrum-settings.js';

describe('spectrum settings clamps', () => {
  it('defaults match the spec', () => {
    expect(SPECTRUM_DEFAULTS).toEqual({
      spectrumEnabled: true,
      spectrumStyle: 'soft',
      spectrumOpacity: 0.5,
      spectrumBarCount: 24,
    });
  });
  it('clamps opacity to [0.05, 0.80]', () => {
    expect(clampSpectrumOpacity(0)).toBe(0.05);
    expect(clampSpectrumOpacity(1)).toBe(0.8);
    expect(clampSpectrumOpacity(0.4)).toBe(0.4);
  });
  it('clamps and rounds bar count to [16, 96]', () => {
    expect(clampSpectrumBarCount(2)).toBe(16);
    expect(clampSpectrumBarCount(200)).toBe(96);
    expect(clampSpectrumBarCount(24.7)).toBe(25);
  });
});
