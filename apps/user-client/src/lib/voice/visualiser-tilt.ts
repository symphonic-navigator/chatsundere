// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Spectral-tilt compensation for the spectrum analyser.
 *
 * Speech energy is heavily bass-weighted (a roughly 1/f roll-off), so the raw
 * FFT makes the low bars saturate to full height while the high bars barely
 * move. We multiply each bar by a monotonic gain that rises from the bass end
 * to the treble end. Because the bars are laid out logarithmically in frequency
 * (see `visualiser-bucketing`), an EXPONENTIAL interpolation of the gain across
 * the bar index is a constant dB-per-octave tilt — the textbook correction.
 *
 * Tuned by eye against real TTS output: the bass bars come down to roughly the
 * same height as the (boosted) treble bars, giving a balanced, lively field.
 * Both constants are safe to nudge — `BASS_GAIN` down / `TREBLE_GAIN` up makes
 * the field flatter; closing the gap makes it more bass-led again.
 */

/** Multiplier applied to the lowest (bass) bar. < 1 attenuates the bass. */
export const BASS_GAIN = 0.45;

/**
 * Multiplier applied to the highest (treble) bar. > 1 lifts the quiet treble.
 * Kept modest on purpose: a large treble gain both amplifies the noisy,
 * fast-changing high bins into visible flicker AND (via the exponential
 * interpolation below) pushes the mid-band gain above 1, which makes the
 * formant-heavy mids saturate. At 1.3 the mid-band gain stays ~0.77 — mids
 * never hit the ceiling — and the treble lift is gentle enough to read calm.
 */
export const TREBLE_GAIN = 1.3;

/**
 * Per-bar tilt multiplier for bar `i` of `n` (i in [0, n-1]). Interpolates
 * exponentially from {@link BASS_GAIN} at the bass end to {@link TREBLE_GAIN}
 * at the treble end — a constant slope in dB across the log-spaced bars.
 */
export function tiltGain(i: number, n: number): number {
  if (n <= 1) return BASS_GAIN;
  const x = i / (n - 1);
  return BASS_GAIN * (TREBLE_GAIN / BASS_GAIN) ** x;
}

/**
 * Apply the spectral tilt to `bins` in place, clamping each result to [0, 1].
 * Operates on the real FFT bins only — the idle-noise field is already flat and
 * must not be tilted.
 */
export function applySpectralTilt(bins: Float32Array): void {
  const n = bins.length;
  for (let i = 0; i < n; i++) {
    const v = (bins[i] ?? 0) * tiltGain(i, n);
    bins[i] = v > 1 ? 1 : v;
  }
}
