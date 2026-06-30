// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import type { MessageRow } from '../../boot/client-data-db.js';
import { OverflowMenu } from '../ui/OverflowMenu.js';

interface Props {
  message: MessageRow;
  onCopy: () => void;
  onBookmark: () => void;
  onRegenerate?: () => void;
  /** Fork the chat at this message. */
  onBranch?: () => void;
  /** Disable branching (e.g. while a stream is live for this chat). */
  branchDisabled?: boolean;
  /** Save this message's visible text as a Markdown artefact. */
  onSave?: () => void;
  /** Whether the message has text to save (disabled-over-hidden otherwise). */
  canSave?: boolean;
  /** Save the conversation up to this persona message as a seed template.
   *  Lives in the overflow (⋯), not the flat row, to avoid crowding at 380px. */
  onSaveAsTemplate?: () => void;
  /** Start reading this message aloud (persona messages only). */
  onReadAloud?: () => void;
  /**
   * Why the Read control is disabled, or null when it is actionable.
   * Drives the three constructive disabled-tooltip tones (spec §4):
   *   'no-provider' → set up a TTS provider
   *   'no-voice'    → give this persona a voice
   *   'nothing'     → nothing speakable in this message
   */
  readDisabledReason?: 'no-provider' | 'no-voice' | 'nothing' | null;
}

const READ_TOOLTIP: Record<'no-provider' | 'no-voice' | 'nothing', string> = {
  'no-provider': 'Set up a TTS provider in My Settings',
  'no-voice': 'Give this persona a voice in its editor',
  nothing: 'Nothing to read aloud in this message',
};

function stop(e: React.MouseEvent): void {
  e.stopPropagation();
}

export function MessageControls(p: Props): JSX.Element {
  const [readNote, setReadNote] = useState(false);
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: stop-propagation wrapper div — not an interactive element, buttons inside handle keyboard events
    <div className="msg-controls" onClick={stop}>
      <button
        type="button"
        data-ctrl="branch"
        onClick={p.onBranch}
        disabled={p.branchDisabled || !p.onBranch}
        title={p.branchDisabled ? 'Branching paused while replying' : 'Branch this chat from here'}
        className="ctrl-btn"
      >
        ✎ Branch
      </button>
      {p.onRegenerate ? (
        <button
          type="button"
          data-ctrl="regenerate"
          onClick={p.onRegenerate}
          title={p.message.kind === 'opener' ? 'Re-roll the greeting' : 'Regenerate this reply'}
          className="ctrl-btn"
        >
          ↻ Regenerate
        </button>
      ) : null}
      <button type="button" data-ctrl="copy" onClick={p.onCopy} className="ctrl-btn">
        ⎘ Copy
      </button>
      <button
        type="button"
        data-ctrl="bookmark"
        onClick={p.onBookmark}
        data-active={p.message.bookmarked || undefined}
        className="ctrl-btn"
      >
        ◈ Bookmark
      </button>
      <button
        type="button"
        data-ctrl="save"
        onClick={p.onSave}
        disabled={!p.canSave || !p.onSave}
        title={p.canSave ? 'Save this message as an artefact' : 'No text to save'}
        className="ctrl-btn"
      >
        ◆ Save
      </button>
      {p.message.role === 'persona' ? (
        <>
          <button
            type="button"
            data-ctrl="read"
            data-disabled={!p.onReadAloud || p.readDisabledReason ? 'true' : undefined}
            aria-disabled={!p.onReadAloud || p.readDisabledReason ? true : undefined}
            onClick={() => {
              if (p.readDisabledReason) {
                setReadNote(true);
                return;
              }
              setReadNote(false);
              p.onReadAloud?.();
            }}
            title={
              p.readDisabledReason ? READ_TOOLTIP[p.readDisabledReason] : 'Read this message aloud'
            }
            className="ctrl-btn"
          >
            ▸ Read
          </button>
          {readNote && p.readDisabledReason ? (
            <output className="ctrl-note">{READ_TOOLTIP[p.readDisabledReason]}</output>
          ) : null}
          {p.onSaveAsTemplate ? (
            <OverflowMenu items={[{ label: 'Save as template', onSelect: p.onSaveAsTemplate }]} />
          ) : null}
        </>
      ) : null}
    </div>
  );
}
