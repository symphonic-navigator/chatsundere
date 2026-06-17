// SPDX-License-Identifier: AGPL-3.0-only
import type { Floor } from '../../lib/voice/live/live-voice-machine.js';

export interface LiveVoiceBarProps {
  floor: Floor;
  fill: number; // 0..1
  level: number; // mic metre for the pulse
  onHold: () => void;
  onResume: () => void;
  onSkip: () => void;
  onExit: () => void;
  onPressStart: () => void;
  onPressEnd: () => void;
  onTap: () => void;
}

// ---------------------------------------------------------------------------
// Inline SVG glyphs — meaning lives in each button's aria-label; glyphs are
// aria-hidden decoration. Copied from VoiceTransport.tsx plus MicIcon /
// InterruptIcon / StrikeIcon for the live-voice–specific states.
// ---------------------------------------------------------------------------

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

/** A circular-arrow retry glyph — shown when transcription failed. */
function RetryIcon(): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width="28"
      height="28"
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

/** A microphone silhouette for the big turn button. */
function MicIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor" aria-hidden="true">
      <rect x="9" y="2" width="6" height="11" rx="3" />
      <path
        d="M5 10a7 7 0 0 0 14 0"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <line
        x1="12"
        y1="17"
        x2="12"
        y2="21"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <line
        x1="9"
        y1="21"
        x2="15"
        y2="21"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Mic with a diagonal strike — shown in the held state. */
function StrikeIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor" aria-hidden="true">
      <rect x="9" y="2" width="6" height="11" rx="3" />
      <path
        d="M5 10a7 7 0 0 0 14 0"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <line
        x1="12"
        y1="17"
        x2="12"
        y2="21"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <line
        x1="9"
        y1="21"
        x2="15"
        y2="21"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      {/* diagonal strike */}
      <line
        x1="4"
        y1="4"
        x2="20"
        y2="20"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Three dots that rise in sequence — the transcribing indicator. */
function TranscribingDots(): JSX.Element {
  return (
    <span className="live-voice-dots" aria-hidden="true">
      <span className="live-voice-dot" />
      <span className="live-voice-dot" />
      <span className="live-voice-dot" />
    </span>
  );
}

/** Waveform / presence pulse — signals the persona is speaking / thinking. */
function PresenceIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor" aria-hidden="true">
      <rect x="2" y="9" width="2" height="6" rx="1" />
      <rect x="6" y="6" width="2" height="12" rx="1" />
      <rect x="10" y="4" width="2" height="16" rx="1" />
      <rect x="14" y="6" width="2" height="12" rx="1" />
      <rect x="18" y="9" width="2" height="6" rx="1" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Helpers for the big button configuration
// ---------------------------------------------------------------------------

interface BigButtonConfig {
  ariaLabel: string;
  content: JSX.Element;
  /** CSS class modifiers applied to the big button element. */
  className: string;
  onClick?: () => void;
  onPointerDown?: () => void;
  onPointerUp?: () => void;
}

function bigButtonConfig(
  floor: Floor,
  fill: number,
  level: number,
  p: LiveVoiceBarProps,
): BigButtonConfig {
  const pulseStyle = 'live-voice-big-btn--pulse';

  switch (floor) {
    case 'listening':
      return {
        ariaLabel: '● listening',
        content: <MicIcon />,
        className: 'live-voice-big-btn live-voice-big-btn--listening',
        onPointerDown: p.onPressStart,
        onPointerUp: p.onPressEnd,
        // No tap handler — a tap while listening is a no-op (you are already heard)
      };
    case 'userSpeaking':
      return {
        ariaLabel: '● speaking',
        content: (
          <>
            <div
              className="live-voice-big-btn-fill"
              style={{ width: `${fill * 100}%` }}
              aria-hidden="true"
            />
            <MicIcon />
          </>
        ),
        className: `live-voice-big-btn live-voice-big-btn--speaking ${level > 0.1 ? pulseStyle : ''}`,
        onPointerDown: p.onPressStart,
        onPointerUp: p.onPressEnd,
      };
    case 'transcribing':
      return {
        ariaLabel: 'Cancel this utterance',
        content: <TranscribingDots />,
        className: 'live-voice-big-btn live-voice-big-btn--transcribing',
        onClick: p.onTap,
      };
    case 'personaThinking':
      return {
        ariaLabel: 'Interrupt — take the floor',
        content: <PresenceIcon />,
        className: `live-voice-big-btn live-voice-big-btn--persona ${pulseStyle}`,
        onClick: p.onTap,
      };
    case 'personaSpeaking':
      return {
        ariaLabel: 'Interrupt — take the floor',
        content: <PresenceIcon />,
        className: `live-voice-big-btn live-voice-big-btn--persona ${pulseStyle}`,
        onClick: p.onTap,
      };
    case 'held':
      return {
        ariaLabel: 'Conversation held',
        content: <StrikeIcon />,
        className: 'live-voice-big-btn live-voice-big-btn--held',
        // No handler — frozen in held state
      };
    case 'sttFailed':
      // Non-ejecting recovery (Spec §6): the big button itself is the
      // constructive next step — tap to try again (RESUME re-arms the mic).
      return {
        ariaLabel: 'Try again',
        content: <RetryIcon />,
        className: 'live-voice-big-btn live-voice-big-btn--failed',
        onClick: p.onResume,
      };
    default:
      return {
        ariaLabel: '● listening',
        content: <MicIcon />,
        className: 'live-voice-big-btn',
      };
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * The live-voice control surface — a sibling of {@link VoiceTransport} that
 * renders while the user is in live voice mode. Purely presentational: props
 * in, callbacks out. It reuses the `.voice-transport*` CSS skeleton and the
 * same constant-Exit-right discipline.
 *
 * Layout:
 *   - Left region: Hold (user/persona floors) or Resume (held) + Skip
 *     (persona-speaking only).
 *   - Centre: the big turn button — its affordance, aria-label, and handlers
 *     change per `floor` (Spec §4).
 *   - Right: constant Exit.
 */
export function LiveVoiceBar(p: LiveVoiceBarProps): JSX.Element {
  // Two fixed left slots that never reflow as the floor changes (Disabled over
  // hidden, §11): slot 1 is Hold — or Resume while held — and slot 2 is Skip.
  // Both always render; an action that is unavailable on the current floor is
  // disabled rather than removed, so the toolbar layout stays put (no jump when
  // e.g. transcribing drops both, or Skip appears on personaSpeaking).
  const isHeld = p.floor === 'held';
  const canHold =
    p.floor === 'listening' ||
    p.floor === 'userSpeaking' ||
    p.floor === 'personaThinking' ||
    p.floor === 'personaSpeaking';
  const canSkip = p.floor === 'personaSpeaking';

  const big = bigButtonConfig(p.floor, p.fill, p.level, p);

  return (
    <section className="voice-transport live-voice-bar" aria-label="Live voice">
      {/* Note line: the held indicator and the constructive STT-failure prompt
          (Spec §6 — a failure never ejects; it offers the next step). */}
      {p.floor === 'held' || p.floor === 'sttFailed' ? (
        <div className="voice-transport-note live-voice-note" aria-live="polite">
          <span>
            {p.floor === 'held' ? 'Conversation held' : "Couldn't hear that — tap to try again"}
          </span>
        </div>
      ) : null}

      <div className="voice-transport-row">
        {/* Left region: two fixed slots (Hold/Resume + Skip), disabled-not-hidden */}
        <div className="voice-transport-left">
          {isHeld ? (
            <button
              type="button"
              className="voice-transport-btn"
              aria-label="Resume the conversation"
              onClick={p.onResume}
            >
              <PlayIcon />
              <span className="voice-transport-label">Resume</span>
            </button>
          ) : (
            <button
              type="button"
              className="voice-transport-btn"
              aria-label="Hold — pause the conversation"
              onClick={p.onHold}
              disabled={!canHold}
            >
              <PauseIcon />
              <span className="voice-transport-label">Hold</span>
            </button>
          )}

          <button
            type="button"
            className="voice-transport-btn"
            aria-label="Skip this passage"
            onClick={p.onSkip}
            disabled={!canSkip}
          >
            <SkipIcon />
            <span className="voice-transport-label">Skip</span>
          </button>
        </div>

        {/* Centre: the big turn button */}
        <button
          type="button"
          className={big.className}
          aria-label={big.ariaLabel}
          onClick={big.onClick}
          onPointerDown={big.onPointerDown}
          onPointerUp={big.onPointerUp}
        >
          {big.content}
        </button>

        {/* Right: constant Exit */}
        <button
          type="button"
          className="voice-transport-exit"
          aria-label="Exit voice"
          onClick={p.onExit}
        >
          <ExitIcon />
          <span className="voice-transport-label">Exit</span>
        </button>
      </div>
    </section>
  );
}
