// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { LightboxTextBody } from './LightboxTextBody';
import type { ViewableItem } from './viewable-item';

export interface LightboxProps {
  items: ViewableItem[];
  index: number;
  onRename: (id: string, name: string) => void;
  onRemove: (id: string) => void;
  onEditText: (id: string, text: string) => void;
  onClose: () => void;
  /** Thumbnail rect for the zoom open/close (FLIP animation). Optional — falls back to a fade. Added in Task 16. */
  originRect?: DOMRect;
}

/**
 * Presentation-only unified lightbox.
 * Toolbar is driven by the current item's caps; navigation loops (chevrons + keyboard ←/→/Esc).
 * Opens with a FLIP zoom from originRect when provided; respects prefers-reduced-motion.
 */
export function Lightbox(p: LightboxProps): JSX.Element | null {
  const [i, setI] = useState(p.index);
  const [renaming, setRenaming] = useState(false);
  const renameRef = useRef<HTMLInputElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const item = p.items[i];

  // Keep the index valid as items shrink (e.g. after a remove).
  useEffect(() => {
    if (p.items.length === 0) {
      p.onClose();
      return;
    }
    if (i >= p.items.length) setI(p.items.length - 1);
  }, [p.items.length, i, p]);

  // Focus the rename input when it mounts, without using the autoFocus attribute.
  useEffect(() => {
    if (renaming) renameRef.current?.focus();
  }, [renaming]);

  // Empty-items guard: skip key handling during the brief gap between an item
  // being removed and onClose firing, so Arrow keys cannot compute 0 % 0 = NaN.
  useEffect(() => {
    if (p.items.length === 0) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') p.onClose();
      else if (e.key === 'ArrowRight') setI((n) => (n + 1) % p.items.length);
      else if (e.key === 'ArrowLeft') setI((n) => (n - 1 + p.items.length) % p.items.length);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [p]);

  // FLIP zoom: on mount, if an originRect is provided, map the lightbox surface
  // onto the thumbnail rect, then transition to identity on the next frame.
  // Guards: no originRect → plain fade; prefers-reduced-motion → no transform;
  // jsdom (tests) → getBoundingClientRect returns zeroes → the early-return below
  // keeps the effect harmless (NaN/Inf transforms would be set but rAF is fine).
  useEffect(() => {
    const el = surfaceRef.current;
    if (!el || !p.originRect) return;
    // Respect the user's motion preference — fall back to the CSS fade.
    if (
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    )
      return;
    const to = el.getBoundingClientRect();
    // Guard: in jsdom getBoundingClientRect returns all-zeros — skip the FLIP
    // rather than setting a degenerate transform (0/0 = NaN scale).
    if (to.width === 0 || to.height === 0) return;
    const sx = p.originRect.width / to.width;
    const sy = p.originRect.height / to.height;
    const dx = p.originRect.left - to.left;
    const dy = p.originRect.top - to.top;
    el.style.transformOrigin = 'top left';
    el.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
    el.style.opacity = '0.6';
    // Transition to the identity state on the next frame so the browser
    // paints the initial position before animating.
    requestAnimationFrame(() => {
      el.style.transition = 'transform 220ms ease, opacity 220ms ease';
      el.style.transform = 'none';
      el.style.opacity = '1';
    });
  }, [p.originRect]);

  if (!item) return null;

  const multi = p.items.length > 1;
  const prev = (): void => setI((n) => (n - 1 + p.items.length) % p.items.length);
  const next = (): void => setI((n) => (n + 1) % p.items.length);

  // Portal to <body> so the overlay escapes every containing block — notably
  // the cockpit's `backdrop-filter` (and any transformed chat-stream ancestor),
  // which would otherwise trap `position: fixed` and confine the lightbox to
  // that subtree instead of the viewport.
  return createPortal(
    <dialog className="lightbox-root" aria-modal="true" open>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: the keyboard handler in the useEffect above already handles Escape; click on backdrop is a mouse shortcut */}
      <div className="lightbox-backdrop" onClick={p.onClose} />
      <div className="lightbox" ref={surfaceRef}>
        <div className="lightbox-top">
          {renaming ? (
            <input
              ref={renameRef}
              className="lightbox-name-edit"
              defaultValue={item.fileName}
              onBlur={(e) => {
                setRenaming(false);
                if (e.target.value.trim()) p.onRename(item.id, e.target.value.trim());
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') setRenaming(false);
              }}
            />
          ) : (
            <button
              type="button"
              className="lightbox-name"
              onClick={() => item.caps.rename && setRenaming(true)}
              title="Rename"
            >
              <span>{item.fileName}</span>
              {item.caps.rename ? <span aria-hidden="true"> ✎</span> : null}
            </button>
          )}
          <span className="lightbox-spacer" />
          {item.caps.download && (
            <button type="button" className="lightbox-btn">
              Download
            </button>
          )}
          {item.caps.delete && (
            <button type="button" className="lightbox-btn lightbox-danger">
              Delete
            </button>
          )}
          {item.caps.remove && (
            <button
              type="button"
              className="lightbox-btn lightbox-danger"
              onClick={() => p.onRemove(item.id)}
            >
              Remove
            </button>
          )}
          <button type="button" className="lightbox-x" aria-label="Close" onClick={p.onClose}>
            ×
          </button>
        </div>
        <div className="lightbox-body">
          {item.kind === 'image' ? (
            <img className="lightbox-img" src={item.imageUrl} alt={item.fileName} />
          ) : (
            <LightboxTextBody item={item} onEditText={p.onEditText} />
          )}
          {multi && (
            <button type="button" className="lightbox-chev l" aria-label="Previous" onClick={prev}>
              ‹
            </button>
          )}
          {multi && (
            <button type="button" className="lightbox-chev r" aria-label="Next" onClick={next}>
              ›
            </button>
          )}
          {multi && (
            <span className="lightbox-counter">
              {i + 1} / {p.items.length}
            </span>
          )}
        </div>
      </div>
    </dialog>,
    document.body,
  );
}
