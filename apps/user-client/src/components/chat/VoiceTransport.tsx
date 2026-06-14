// SPDX-License-Identifier: AGPL-3.0-only
import type { DisabledReason } from '../../lib/voice/use-voice-playback.js';
import type { TransportState } from '../../lib/voice/voice-machine.js';

export interface VoiceTransportProps {
  state: TransportState;
  /** When set (idle), the on-return resume offer is shown. The caller derives
   *  `paragraphLabel` (e.g. '¶3') from the remembered index. */
  resumeOffer: { paragraphLabel: string } | null;
  /** Count of segments the provider declined and the read auto-skipped past. */
  providerSkips: number;
  /** True when auto-read-aloud is on — drives the armed/ready surface at idle so
   *  "toolbar visible" and "the next reply reads itself" are the same fact. */
  autoReadOn: boolean;
  /** Null when voice is available; a reason when unavailable. While armed, a
   *  reason renders a greyed-with-reason surface rather than silently retracting
   *  (disabled over hidden). */
  voiceUnavailable: DisabledReason;
  onPause: () => void;
  onResume: () => void;
  onSkip: () => void;
  onRetry: () => void;
  /** Resume playback from the remembered position (the on-return offer). */
  onResumePlayback: () => void;
  /** Discard the resume offer and start the message from the beginning. */
  onStartOver: () => void;
  /** Dismiss a purely-informational terminal notice (partial-finish / skip note). */
  onDismiss: () => void;
  /** The holistic voice-surface exit ("Leave"): stop this playback and, if
   *  auto-read is armed, turn it off. One context-correct escape — what retires
   *  the old Stop-vs-toggle stop hint. */
  onExitVoice: () => void;
}

function unavailableNote(reason: DisabledReason): string {
  return reason === 'no-provider'
    ? 'Voice unavailable — no provider configured'
    : 'Voice unavailable — this persona has no voice';
}

function skipNote(n: number): string {
  return n === 1
    ? 'Skipped a passage the voice provider declined'
    : `Skipped ${n} passages the voice provider declined`;
}

// Inline SVG transport glyphs (the app has no icon library). The meaning lives
// in each button's aria-label; the glyphs are aria-hidden decoration.
function PauseIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  );
}
function PlayIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}
function SkipIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
      <path d="M6 5v14l8-7z" />
      <rect x="15" y="5" width="3" height="14" rx="1" />
    </svg>
  );
}
function RetryIcon(): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 4v4h4" />
    </svg>
  );
}
function ExitIcon(): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  );
}
function DismissIcon(): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width="22"
      height="22"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

/**
 * The persistent audio toolbar (spec 2026-06-14). A space-reserving, cockpit-
 * independent control surface for voice playback. Skeleton: an optional note
 * line (rendered only when it has something to say, so the toolbar stays
 * compact) above a button row whose RIGHT slot is a constant escape
 * ("Exit" / "Dismiss") and whose LEFT region carries the contextual playback
 * actions plus an always-present Skip while something is or can be playing.
 *
 * Purely presentational: props in, callbacks out. It imports no playback hook —
 * the chat page owns {@link useVoicePlayback} and wires it here, including the
 * holistic {@link VoiceTransportProps.onExitVoice}.
 */
export function VoiceTransport(p: VoiceTransportProps): JSX.Element | null {
  const armed =
    p.state === 'idle' && p.autoReadOn && p.resumeOffer === null && p.providerSkips === 0;
  const readyArmed = armed && p.voiceUnavailable === null;
  const unavailableArmed = armed && p.voiceUnavailable !== null;

  const visible = p.state !== 'idle' || armed || p.resumeOffer !== null || p.providerSkips > 0;
  if (!visible) return null;

  // Right slot: Dismiss for purely-informational terminal notices (nothing to
  // leave); Leave (holistic exit) in every state with a session/offer/armed mode.
  const rightIsDismiss =
    p.state === 'ended-partial' || (p.state === 'idle' && p.providerSkips > 0 && !armed);

  const showSkip =
    p.state === 'speaking' ||
    p.state === 'waiting' ||
    p.state === 'paused' ||
    p.state === 'failed' ||
    armed;

  const note =
    p.state === 'waiting'
      ? 'reading…'
      : p.state === 'failed'
        ? "Couldn't read this part aloud"
        : p.state === 'ended-partial'
          ? "Couldn't finish reading aloud — Retry?"
          : unavailableArmed
            ? unavailableNote(p.voiceUnavailable)
            : p.providerSkips > 0
              ? skipNote(p.providerSkips)
              : '';

  return (
    <section className="voice-transport" aria-label="Voice playback">
      {/* Note line: rendered only when there is something to say, so the toolbar
          stays compact in the common states (no reserved-empty line). Important
          notices — failure, provider-skip, voice-unavailable — and the resume
          offer still surface; the armed state needs no text (the open toolbar
          plus the ready indicator is signal enough). */}
      {note || p.resumeOffer ? (
        <div className="voice-transport-note" aria-live="polite">
          {note ? <span>{note}</span> : null}
          {p.resumeOffer ? (
            <button
              type="button"
              className="voice-transport-startover"
              aria-label="Start over from the beginning"
              onClick={p.onStartOver}
            >
              Start over
            </button>
          ) : null}
        </div>
      ) : null}

      <div className="voice-transport-row">
        <div className="voice-transport-left">
          {p.state === 'speaking' || p.state === 'waiting' ? (
            <button
              type="button"
              className="voice-transport-btn"
              aria-label="Pause reading"
              onClick={p.onPause}
            >
              <PauseIcon />
              <span className="voice-transport-label">Pause</span>
            </button>
          ) : null}

          {p.state === 'paused' ? (
            <button
              type="button"
              className="voice-transport-btn"
              aria-label="Resume reading"
              onClick={p.onResume}
            >
              <PlayIcon />
              <span className="voice-transport-label">Resume</span>
            </button>
          ) : null}

          {p.state === 'failed' || p.state === 'ended-partial' ? (
            <button
              type="button"
              className="voice-transport-btn"
              aria-label="Retry reading"
              onClick={p.onRetry}
            >
              <RetryIcon />
              <span className="voice-transport-label">Retry</span>
            </button>
          ) : null}

          {p.resumeOffer ? (
            <button
              type="button"
              className="voice-transport-btn"
              aria-label={`Resume reading from ${p.resumeOffer.paragraphLabel}`}
              onClick={p.onResumePlayback}
            >
              <PlayIcon />
              <span className="voice-transport-label">{p.resumeOffer.paragraphLabel}</span>
            </button>
          ) : null}

          {/* Armed-and-available: a distinct calm "ready" indicator, NOT a greyed
              Pause glyph (a disabled ⏸ reads as "paused"). Spec §3.1a. */}
          {readyArmed ? (
            <span className="voice-transport-ready" aria-label="Voice mode armed">
              ● ready
            </span>
          ) : null}

          {/* Armed-but-unavailable: honest greyed Pause (the capability really is
              off), distinct from the ready dot above. */}
          {unavailableArmed ? (
            <button
              type="button"
              className="voice-transport-btn"
              aria-label="Pause reading (voice unavailable)"
              disabled
            >
              <PauseIcon />
              <span className="voice-transport-label">Pause</span>
            </button>
          ) : null}

          {showSkip ? (
            <button
              type="button"
              className="voice-transport-btn"
              aria-label="Skip this part"
              onClick={p.onSkip}
              disabled={armed}
            >
              <SkipIcon />
              <span className="voice-transport-label">Skip</span>
            </button>
          ) : null}
        </div>

        <button
          type="button"
          className="voice-transport-exit"
          aria-label={rightIsDismiss ? 'Dismiss' : 'Exit voice'}
          onClick={rightIsDismiss ? p.onDismiss : p.onExitVoice}
        >
          {rightIsDismiss ? <DismissIcon /> : <ExitIcon />}
          <span className="voice-transport-label">{rightIsDismiss ? 'Dismiss' : 'Exit'}</span>
        </button>
      </div>
    </section>
  );
}
