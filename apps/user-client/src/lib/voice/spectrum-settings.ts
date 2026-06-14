// SPDX-License-Identifier: AGPL-3.0-only

export type SpectrumStyle = 'sharp' | 'soft' | 'glow';

export const SPECTRUM_DEFAULTS = {
  spectrumEnabled: true,
  spectrumStyle: 'soft' as SpectrumStyle,
  spectrumOpacity: 0.5,
  spectrumBarCount: 24,
} as const;

export const SPECTRUM_OPACITY_MIN = 0.05;
export const SPECTRUM_OPACITY_MAX = 0.8;
export const SPECTRUM_BARCOUNT_MIN = 16;
export const SPECTRUM_BARCOUNT_MAX = 96;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Clamp opacity to its valid display range. */
export function clampSpectrumOpacity(v: number): number {
  return clamp(v, SPECTRUM_OPACITY_MIN, SPECTRUM_OPACITY_MAX);
}

/** Clamp bar count to range and round to an integer. */
export function clampSpectrumBarCount(v: number): number {
  return clamp(Math.round(v), SPECTRUM_BARCOUNT_MIN, SPECTRUM_BARCOUNT_MAX);
}
