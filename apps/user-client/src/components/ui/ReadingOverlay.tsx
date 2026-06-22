// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useLayoutEffect, useRef } from 'react';
import { computeTransformOrigin } from '../../lib/origin-zoom.js';
import { MarkdownContent } from '../chat/markdown/MarkdownContent.js';

export interface ReadingOverlayProps {
  open: boolean;
  /** What the user is reading — shown in the fixed title bar. */
  title: string;
  /** Raw Markdown source. */
  markdown: string;
  onClose: () => void;
  /** The element the overlay zooms out of (the tapped tile / ? button). */
  triggerRef?: React.RefObject<HTMLElement | null>;
}

/**
 * A zoom-in Markdown reader (spec §5): insets with margin, dims the screen
 * around it, opulent surface with gold-tinted headings, a fixed title bar and a
 * prominent × (also Esc / backdrop-tap). Long content scrolls under the fixed
 * title. Zooms out of the trigger rect, mirroring ConfirmDialog.
 */
export function ReadingOverlay({
  open,
  title,
  markdown,
  onClose,
  triggerRef,
}: ReadingOverlayProps): JSX.Element | null {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Origin-zoom: set transform-origin from the trigger before paint.
  useLayoutEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    const trigger = triggerRef?.current;
    if (panel && trigger) {
      panel.style.transformOrigin = computeTransformOrigin(
        trigger.getBoundingClientRect(),
        panel.getBoundingClientRect(),
      );
    }
  }, [open, triggerRef]);

  // Escape to close + focus the × on open + restore focus on close.
  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previouslyFocused?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    // biome-ignore lint/a11y/useSemanticElements: fixed stacking layer that drives CSS animation; <dialog> requires showModal() which conflicts with our zoom entry
    <div className="cs-reader-root" role="dialog" aria-modal="true" aria-label={title}>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop tap maps to close; Escape is handled on window */}
      <div
        data-testid="cs-reader-backdrop"
        className="cs-reader-backdrop"
        onClick={onClose}
        aria-hidden="true"
      />
      <div ref={panelRef} className="cs-reader-panel cs-zoom-in">
        <header className="cs-reader-titlebar">
          <h2 className="cs-reader-title">{title}</h2>
          <button
            ref={closeRef}
            type="button"
            aria-label="Close"
            className="cs-reader-close"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <div className="cs-reader-scroll">
          <MarkdownContent text={markdown} />
        </div>
      </div>
    </div>
  );
}
