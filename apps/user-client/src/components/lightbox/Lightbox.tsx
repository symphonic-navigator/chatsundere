// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { FormatPicker } from './FormatPicker';
import { LightboxTextBody } from './LightboxTextBody';
import { type PreviewFormat, detectFormat, formatToExtension } from './format-detect';
import { copyText, downloadText } from './lightbox-actions';
import type { ViewableItem } from './viewable-item';

export interface LightboxProps {
  items: ViewableItem[];
  index: number;
  onRename: (id: string, name: string) => void;
  onRemove: (id: string) => void;
  onEditText: (id: string, text: string) => void;
  onClose: () => void;
  /** Resolve the live rect of the origin thumbnail for item `id`, for the FLIP
   *  open/close zoom. Returns null when the origin is gone (scrolled away/detached).
   *  Implemented by the caller via `[data-attachment-thumb="<id>"]`. */
  getOriginRect?: (id: string) => DOMRect | null;
}

/**
 * Presentation-only unified lightbox.
 * Toolbar is driven by the current item's caps; navigation loops (chevrons + keyboard ←/→/Esc).
 * Opens with a FLIP zoom from the origin thumb when getOriginRect is provided; respects
 * prefers-reduced-motion. Close zooms back to the thumb (or downward off-screen if gone).
 */
export function Lightbox(p: LightboxProps): JSX.Element | null {
  const [i, setI] = useState(p.index);
  const [renaming, setRenaming] = useState(false);
  const [override, setOverride] = useState<PreviewFormat | null>(null);
  const [copied, setCopied] = useState(false);
  const renameRef = useRef<HTMLInputElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const closingRef = useRef(false);
  // Stable ref to requestClose — assigned below after the item guard, read by effects above.
  // requestClose is a hoisted function declaration so effects can safely call closeRef.current().
  const closeRef = useRef<() => void>(() => {
    /* placeholder; overwritten each render */
  });
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
      if (e.key === 'Escape') closeRef.current();
      else if (e.key === 'ArrowRight') setI((n) => (n + 1) % p.items.length);
      else if (e.key === 'ArrowLeft') setI((n) => (n - 1 + p.items.length) % p.items.length);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [p]);

  // FLIP open: map the surface onto the origin thumb, then animate to identity.
  // Runs once on mount; guards: reduced motion / missing or zero-size origin.
  // biome-ignore lint/correctness/useExhaustiveDependencies: open zoom is a mount-only effect
  useEffect(() => {
    const el = surfaceRef.current;
    if (!el || reducedMotion()) return;
    const origin = p.getOriginRect?.(p.items[p.index]?.id ?? '') ?? null;
    if (!origin || origin.width === 0 || origin.height === 0) return;
    const to = el.getBoundingClientRect();
    if (to.width === 0 || to.height === 0) return;
    const sx = origin.width / to.width;
    const sy = origin.height / to.height;
    el.style.transformOrigin = 'top left';
    el.style.transform = `translate(${origin.left - to.left}px, ${origin.top - to.top}px) scale(${sx}, ${sy})`;
    el.style.opacity = '0.6';
    requestAnimationFrame(() => {
      el.style.transition = 'transform 220ms ease, opacity 220ms ease';
      el.style.transform = 'none';
      el.style.opacity = '1';
    });
  }, []);

  // Bridge Escape from inside the HTML-preview iframe.
  useEffect(() => {
    const onMsg = (e: MessageEvent): void => {
      if (e.data?.type === 'lightbox-escape') closeRef.current();
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  // Reset the format override + copied flash when the viewed item changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `i` is intentionally listed as a trigger; the effect only calls stable setters, which biome would otherwise flag as "no deps needed"
  useEffect(() => {
    setOverride(null);
    setCopied(false);
  }, [i]);

  if (!item) return null;

  const format: PreviewFormat =
    item.kind === 'text' ? (override ?? detectFormat(item.fileName, item.mime)) : 'plain';

  const multi = p.items.length > 1;
  const prev = (): void => setI((n) => (n - 1 + p.items.length) % p.items.length);
  const next = (): void => setI((n) => (n + 1) % p.items.length);

  const DURATION = 220;

  function reducedMotion(): boolean {
    return (
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  }

  function rectVisible(r: DOMRect | null): r is DOMRect {
    return (
      !!r &&
      r.width > 0 &&
      r.height > 0 &&
      r.bottom > 0 &&
      r.right > 0 &&
      r.top < window.innerHeight &&
      r.left < window.innerWidth
    );
  }

  // Map the surface el onto `target` (top-left origin) — the END state for close.
  function transformOnto(el: HTMLDivElement, target: DOMRect): void {
    const from = el.getBoundingClientRect();
    if (from.width === 0 || from.height === 0) return;
    const sx = target.width / from.width;
    const sy = target.height / from.height;
    const dx = target.left - from.left;
    const dy = target.top - from.top;
    el.style.transformOrigin = 'top left';
    el.style.transform = `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`;
    el.style.opacity = '0';
  }

  function requestClose(): void {
    if (closingRef.current) return;
    closingRef.current = true;
    const el = surfaceRef.current;
    if (!el || reducedMotion()) {
      p.onClose();
      return;
    }
    const live = p.getOriginRect?.(item?.id ?? '') ?? null;
    // Visible → zoom back to the thumb; otherwise zoom downward off-screen.
    const target: DOMRect = rectVisible(live)
      ? live
      : ({
          left: window.innerWidth / 2 - 30,
          top: window.innerHeight + 40,
          width: 60,
          height: 60,
        } as DOMRect);
    let done = false;
    const finish = (): void => {
      if (done) return;
      done = true;
      p.onClose();
    };
    el.addEventListener('transitionend', finish, { once: true });
    window.setTimeout(finish, DURATION + 60);
    requestAnimationFrame(() => {
      el.style.transition = `transform ${DURATION}ms ease, opacity ${DURATION}ms ease`;
      transformOnto(el, target);
    });
  }

  closeRef.current = requestClose;

  // Portal to <body> so the overlay escapes every containing block — notably
  // the cockpit's `backdrop-filter` (and any transformed chat-stream ancestor),
  // which would otherwise trap `position: fixed` and confine the lightbox to
  // that subtree instead of the viewport.
  return createPortal(
    <dialog className="lightbox-root" aria-modal="true" open>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: the keyboard handler in the useEffect above already handles Escape; click on backdrop is a mouse shortcut */}
      <div className="lightbox-backdrop" onClick={requestClose} />
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
          {item.kind === 'text' && <FormatPicker value={format} onChange={(f) => setOverride(f)} />}
          {item.caps.copy && (
            <button
              type="button"
              className="lightbox-btn"
              onClick={() => {
                void copyText(item.text ?? '');
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          )}
          {item.caps.download && (
            <button
              type="button"
              className="lightbox-btn"
              onClick={() =>
                downloadText(item.text ?? '', formatToExtension(item.fileName, format))
              }
            >
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
          <button type="button" className="lightbox-x" aria-label="Close" onClick={requestClose}>
            ×
          </button>
        </div>
        <div className="lightbox-body">
          {item.kind === 'image' ? (
            <img className="lightbox-img" src={item.imageUrl} alt={item.fileName} />
          ) : (
            <LightboxTextBody item={item} format={format} onEditText={p.onEditText} />
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
