// SPDX-License-Identifier: AGPL-3.0-only

import type { Dictation } from '../../lib/voice/dictation/use-dictation.js';

interface Props {
  hasText: boolean;
  isStreamLive: boolean;
  personaName: string;
  onSend: () => void;
  onStop: () => void;
  dictation: Dictation;
}

/**
 * The cockpit's single action button. Strict priority (spec 2026-06-12 §3.1):
 * stream-stop > active capture > transcribing > send > mic. Capture owns the
 * button while a VAD session listens — even once transcripts have landed in
 * the draft — because a running session must keep its stop control.
 */
export function DualActionBtn(p: Props): JSX.Element {
  if (p.isStreamLive) {
    return (
      <button
        type="button"
        className="dual-action-btn"
        data-dual="stop"
        title={`Stop ${p.personaName}`}
        aria-label={`Stop ${p.personaName}`}
        onClick={p.onStop}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
          <rect x="6" y="6" width="12" height="12" rx="2" />
        </svg>
      </button>
    );
  }

  if (p.dictation.uiState === 'capturing') {
    return (
      <button
        type="button"
        className="dual-action-btn dual-action-capture"
        data-dual="capture"
        title="Stop listening"
        aria-label="Stop listening"
        style={{ '--mic-level': p.dictation.level } as React.CSSProperties}
        onClick={p.dictation.tap}
        onPointerUp={p.dictation.pressEnd}
        onPointerLeave={p.dictation.pressCancel}
      >
        <MicGlyph />
      </button>
    );
  }

  if (p.dictation.uiState === 'transcribing') {
    return (
      <button
        type="button"
        className="dual-action-btn"
        data-dual="cancel-transcribe"
        title="Cancel transcription"
        aria-label="Cancel transcription"
        onClick={p.dictation.cancel}
      >
        <svg
          viewBox="0 0 24 24"
          width="20"
          height="20"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          aria-hidden="true"
        >
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    );
  }

  if (p.hasText) {
    return (
      <button
        type="button"
        className="dual-action-btn"
        data-dual="action"
        title="Send"
        aria-label="Send"
        onClick={p.onSend}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
          <path d="M5 12l14-7-5 14-2-7-7-0z" />
        </svg>
      </button>
    );
  }

  const available = p.dictation.available;
  return (
    <button
      type="button"
      className="dual-action-btn"
      data-dual="mic"
      disabled={available ? undefined : true}
      title={
        available
          ? 'Hold to talk · tap to dictate'
          : 'Add a Mistral provider in My Settings to dictate'
      }
      aria-label={available ? 'Dictate' : 'Microphone (disabled)'}
      onPointerDown={available ? p.dictation.pressStart : undefined}
      onPointerUp={available ? p.dictation.pressEnd : undefined}
      onPointerLeave={available ? p.dictation.pressCancel : undefined}
    >
      <MicGlyph />
    </button>
  );
}

function MicGlyph(): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      aria-hidden="true"
    >
      <rect x="9" y="3" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}
