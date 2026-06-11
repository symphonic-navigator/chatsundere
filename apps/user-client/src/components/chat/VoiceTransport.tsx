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
  // Idle without a resume offer: render nothing at all.
  if (p.state === 'idle' && !p.resumeOffer) return null;

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
    </section>
  );
}
