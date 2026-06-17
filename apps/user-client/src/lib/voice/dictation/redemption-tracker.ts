// SPDX-License-Identifier: AGPL-3.0-only

/**
 * A pure, frame-driven replica of vad-web's redemption countdown, exposing it
 * as a 0→1 fill the UI can render (vad-web keeps the window internal and emits
 * no progress). Fed one `onFrameProcessed` speech probability per frame.
 *
 * The fill begins only after speech has been seen (so background silence never
 * shows a countdown), advances while frames sit below the negative threshold,
 * and resets to 0 the instant a frame crosses back above the positive
 * threshold (speech resumed). It mirrors the same thresholds passed to
 * `MicVAD.new`, so the fill reaches ~1 just as vad-web fires `onSpeechEnd`.
 */
export interface RedemptionTrackerOptions {
  positiveSpeechThreshold: number;
  negativeSpeechThreshold: number;
  redemptionMs: number;
  /** Silero legacy frame duration: 1536 samples @ 16 kHz = 96 ms. */
  frameMs: number;
}

export class RedemptionTracker {
  private speaking = false;
  private silenceMs = 0;

  constructor(private readonly opts: RedemptionTrackerOptions) {}

  /** Feed one frame's speech probability; returns the current fill fraction 0..1. */
  frame(isSpeechProb: number): number {
    if (isSpeechProb >= this.opts.positiveSpeechThreshold) {
      this.speaking = true;
      this.silenceMs = 0;
      return 0;
    }
    if (this.speaking && isSpeechProb < this.opts.negativeSpeechThreshold) {
      this.silenceMs += this.opts.frameMs;
    }
    return this.speaking ? Math.min(1, this.silenceMs / this.opts.redemptionMs) : 0;
  }

  /** Return to the pre-speech state (call on speech-end / session stop). */
  reset(): void {
    this.speaking = false;
    this.silenceMs = 0;
  }
}
