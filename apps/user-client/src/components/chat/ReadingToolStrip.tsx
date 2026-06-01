// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef } from 'react';
import { useCurrentChatStore } from '../../state/current-chat.store.js';

interface Props {
  /** Open the per-chat ToC / bookmarks sheet. */
  onOpenToc: () => void;
}

/**
 * Ghostly, self-revealing reading-mode control, top-right. Collapsed it is a
 * single drop-down arrow; expanded it reveals a pin and the bookmark/ToC
 * button (more icons land here later). Unpinned, it collapses on the first
 * interaction outside the strip.
 */
export function ReadingToolStrip(p: Props): JSX.Element {
  const expanded = useCurrentChatStore((s) => s.isToolStripExpanded);
  const pinned = useCurrentChatStore((s) => s.isToolStripPinned);
  const setExpanded = useCurrentChatStore((s) => s.setToolStripExpanded);
  const togglePin = useCurrentChatStore((s) => s.toggleToolStripPin);
  const collapseIfUnpinned = useCurrentChatStore((s) => s.collapseToolStripIfUnpinned);
  const rootRef = useRef<HTMLDivElement>(null);

  // Dismiss-on-outside-interaction. Active only while expanded; pinned strips
  // ignore it (the store action guards). Capture phase so we see the event
  // before downstream handlers (e.g. opening the cockpit) consume it.
  useEffect(() => {
    if (!expanded) return undefined;
    const onOutside = (e: Event): void => {
      const target = e.target as Node | null;
      if (target && rootRef.current?.contains(target)) return;
      collapseIfUnpinned();
    };
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onOutside, true);
    document.addEventListener('wheel', onOutside, true);
    return () => {
      document.removeEventListener('pointerdown', onOutside, true);
      document.removeEventListener('keydown', onOutside, true);
      document.removeEventListener('wheel', onOutside, true);
    };
  }, [expanded, collapseIfUnpinned]);

  return (
    <div ref={rootRef} className="reading-tool-strip" data-expanded={expanded || undefined}>
      <button
        type="button"
        className="tool-strip-toggle"
        aria-label={expanded ? 'Hide tools' : 'Show tools'}
        aria-expanded={expanded}
        onClick={() => setExpanded(!expanded)}
      >
        <span aria-hidden>▾</span>
      </button>
      {expanded ? (
        <div className="tool-strip-actions">
          <button
            type="button"
            className="tool-strip-btn"
            data-active={pinned || undefined}
            aria-pressed={pinned}
            aria-label="Keep tools open"
            onClick={togglePin}
          >
            <span aria-hidden>📌</span>
          </button>
          <button
            type="button"
            className="tool-strip-btn"
            aria-label="Bookmarks and contents"
            onClick={p.onOpenToc}
          >
            <span aria-hidden>◈</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
