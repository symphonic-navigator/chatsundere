// SPDX-License-Identifier: AGPL-3.0-only

/** User-facing VAD sensitivity level. Maps to Silero energy thresholds. */
export type VadSensitivity = 'low' | 'medium' | 'high';

export interface VadPreset {
  positiveSpeechThreshold: number;
  negativeSpeechThreshold: number;
  minSpeechFrames: number;
}

// Preset table is expressed in frames (matching Silero's native units) and is
// ported 1:1 from chatsune, where the values were tuned empirically on device
// and praised by users — do not replace with vad-web library defaults.
// `minSpeechFrames` is intentionally identical for medium and high (5): short
// utterances otherwise slip below the high threshold's 8-frame minimum and
// never trigger a speech-start. Energy sensitivity (positive/negative
// thresholds) is strictly monotonic across the presets — that is the parameter
// the user actually tunes.
export const VAD_PRESETS: Record<VadSensitivity, VadPreset> = {
  low: { positiveSpeechThreshold: 0.5, negativeSpeechThreshold: 0.35, minSpeechFrames: 3 },
  medium: { positiveSpeechThreshold: 0.65, negativeSpeechThreshold: 0.5, minSpeechFrames: 5 },
  high: { positiveSpeechThreshold: 0.8, negativeSpeechThreshold: 0.6, minSpeechFrames: 5 },
};

export const REDEMPTION_MS_MIN = 576; // 6 frames — below this VAD gets twitchy
export const REDEMPTION_MS_MAX = 11_520; // 120 frames
export const REDEMPTION_MS_DEFAULT = 1_728; // 18 frames
