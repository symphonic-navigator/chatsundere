// SPDX-License-Identifier: AGPL-3.0-only
import type { TransportState } from '../../lib/voice/voice-machine.js';

export interface VoiceTransportProps {
  state: TransportState;
  /** When set (and state is idle), the on-return resume offer is shown. The
   *  caller derives `paragraphLabel` (e.g. '¶3') from the remembered index. */
  resumeOffer: { paragraphLabel: string } | null;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
  onRetry: () => void;
  onSkip: () => void;
  /** Resume playback from the remembered position (the on-return offer). */
  onResumePlayback: () => void;
  /** Discard the resume offer and start the message from the beginning. */
  onStartOver: () => void;
  /** Dismiss the partial-finish closing note. */
  onDismiss: () => void;
  /**
   * Count of segments the voice provider declined on content grounds and the
   * read auto-skipped past (e.g. Mistral Voxtral's 403 on benign text). When
   * non-zero, an honest note is shown so the skipped passage is never silent.
   */
  providerSkips: number;
}

/**
 * The persistent voice transport (spec §4, Laura hard finding). It governs an
 * in-flight read-aloud independently of message expansion, scrolling, and
 * Reading↔Interaction mode — the per-message Read control only ever STARTS
 * playback. Renders NOTHING when idle without a resume offer, honouring the
 * "less distraction" intent that retired the old ReadingToolStrip (commit
 * 4f6fd02).
 *
 * Purely presentational: props in, callbacks out. It imports no playback hook —
 * the chat page owns the {@link useVoicePlayback} state and wires it here.
 */
export function VoiceTransport(p: VoiceTransportProps): JSX.Element | null {
  // Idle without a resume offer or a skipped-passage note: render nothing.
  if (p.state === 'idle' && !p.resumeOffer && p.providerSkips === 0) return null;

  return (
    <section className="voice-transport" aria-label="Voice playback">
      {p.state === 'speaking' ? (
        <>
          <button
            type="button"
            className="voice-transport-btn"
            aria-label="Pause reading"
            onClick={p.onPause}
          >
            Pause
          </button>
          <button
            type="button"
            className="voice-transport-btn"
            aria-label="Stop reading"
            onClick={p.onStop}
          >
            Stop
          </button>
        </>
      ) : null}

      {p.state === 'paused' ? (
        <>
          <button
            type="button"
            className="voice-transport-btn"
            aria-label="Resume reading"
            onClick={p.onResume}
          >
            Resume
          </button>
          <button
            type="button"
            className="voice-transport-btn"
            aria-label="Stop reading"
            onClick={p.onStop}
          >
            Stop
          </button>
        </>
      ) : null}

      {p.state === 'failed' ? (
        <>
          <span className="voice-transport-note">Couldn't read this part aloud</span>
          <button
            type="button"
            className="voice-transport-btn"
            aria-label="Retry reading this part"
            onClick={p.onRetry}
          >
            Retry
          </button>
          <button
            type="button"
            className="voice-transport-btn"
            aria-label="Skip this part"
            onClick={p.onSkip}
          >
            Skip
          </button>
          <button
            type="button"
            className="voice-transport-btn"
            aria-label="Stop reading"
            onClick={p.onStop}
          >
            Stop
          </button>
        </>
      ) : null}

      {p.state === 'ended-partial' ? (
        <>
          <span className="voice-transport-note">Couldn't finish reading aloud — Retry?</span>
          <button
            type="button"
            className="voice-transport-btn"
            aria-label="Retry reading"
            onClick={p.onRetry}
          >
            Retry
          </button>
          <button
            type="button"
            className="voice-transport-btn"
            aria-label="Dismiss"
            onClick={p.onDismiss}
          >
            Dismiss
          </button>
        </>
      ) : null}

      {p.state === 'idle' && p.resumeOffer ? (
        <>
          <button
            type="button"
            className="voice-transport-btn"
            aria-label={`Resume reading from ${p.resumeOffer.paragraphLabel}`}
            onClick={p.onResumePlayback}
          >
            {`Resume · ${p.resumeOffer.paragraphLabel}`}
          </button>
          <button
            type="button"
            className="voice-transport-btn voice-transport-btn-secondary"
            aria-label="Start over from the beginning"
            onClick={p.onStartOver}
          >
            Start over
          </button>
        </>
      ) : null}

      {/* Honest note for passages the provider declined (auto-skipped). Shown
          live during the read and persisted at idle with a Dismiss — the read
          never halts on these, but the gap is never silent either. */}
      {p.providerSkips > 0 ? (
        <span className="voice-transport-note">
          {p.providerSkips === 1
            ? 'Skipped a passage the voice provider declined'
            : `Skipped ${p.providerSkips} passages the voice provider declined`}
        </span>
      ) : null}
      {p.state === 'idle' && p.providerSkips > 0 ? (
        <button
          type="button"
          className="voice-transport-btn"
          aria-label="Dismiss"
          onClick={p.onDismiss}
        >
          Dismiss
        </button>
      ) : null}
    </section>
  );
}
