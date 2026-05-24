// SPDX-License-Identifier: AGPL-3.0-only
import type { MessageRow } from '../../boot/client-data-db.js';

interface Props {
  message: MessageRow;
  onCopy: () => void;
  onBookmark: () => void;
  onRegenerate?: () => void;
}

function stop(e: React.MouseEvent): void {
  e.stopPropagation();
}

export function MessageControls(p: Props): JSX.Element {
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: stop-propagation wrapper div — not an interactive element, buttons inside handle keyboard events
    <div className="msg-controls" onClick={stop}>
      <button
        type="button"
        data-ctrl="branch"
        disabled
        title="Branching arrives later"
        className="ctrl-btn"
      >
        ✎ Branch
      </button>
      {p.onRegenerate ? (
        <button type="button" data-ctrl="regenerate" onClick={p.onRegenerate} className="ctrl-btn">
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
        data-ctrl="read"
        disabled
        title="Voice arrives with Block 4"
        className="ctrl-btn"
      >
        ▸ Read
      </button>
    </div>
  );
}
