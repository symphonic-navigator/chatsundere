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
 * Editable text items keep an in-memory draft: Save persists it, Undo reverts to the last
 * saved value, and closing/navigating while dirty asks for confirmation first.
 */
export function Lightbox(p: LightboxProps): JSX.Element | null {
  const [i, setI] = useState(p.index);
  const [renaming, setRenaming] = useState(false);
  const [override, setOverride] = useState<PreviewFormat | null>(null);
  const [copied, setCopied] = useState(false);
  // Edit buffer + last-saved baseline for the current text item.
  const [draft, setDraft] = useState(p.items[p.index]?.text ?? '');
  const [baseline, setBaseline] = useState(p.items[p.index]?.text ?? '');
  // When set, a destructive navigation/close is pending behind the dirty-confirm bar.
  const [confirming, setConfirming] = useState<{ run: () => void } | null>(null);
  const renameRef = useRef<HTMLInputElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const closingRef = useRef(false);
  // Stable refs to the latest close/navigation handlers, so the keydown + iframe
  // listeners (registered once) always invoke the current, dirty-guarded versions.
  const closeRef = useRef<() => void>(() => {
    /* placeholder; overwritten each render */
  });
  const navRef = useRef<{ prev: () => void; next: () => void }>({ prev: () => {}, next: () => {} });
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
      else if (e.key === 'ArrowRight') navRef.current.next();
      else if (e.key === 'ArrowLeft') navRef.current.prev();
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

  // Reset per-item view state (override, copied flash, edit buffer, confirm bar)
  // whenever the viewed item changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `i` is intentionally the only trigger; the body reads the freshly-indexed item and calls stable setters
  useEffect(() => {
    setOverride(null);
    setCopied(false);
    setDraft(p.items[i]?.text ?? '');
    setBaseline(p.items[i]?.text ?? '');
    setConfirming(null);
  }, [i]);

  if (!item) return null;

  const format: PreviewFormat =
    item.kind === 'text' ? (override ?? detectFormat(item.fileName, item.mime)) : 'plain';

  const editable = item.kind === 'text' && item.caps.editSource;
  const dirty = editable && draft !== baseline;

  // Run an action immediately, or — if there are unsaved edits — defer it behind
  // the dirty-confirm bar.
  function guard(run: () => void): void {
    if (dirty) setConfirming({ run });
    else run();
  }
  function save(): void {
    if (!item) return;
    p.onEditText(item.id, draft);
    setBaseline(draft);
  }

  const multi = p.items.length > 1;
  const prev = (): void => guard(() => setI((n) => (n - 1 + p.items.length) % p.items.length));
  const next = (): void => guard(() => setI((n) => (n + 1) % p.items.length));
  navRef.current = { prev, next };

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

  // Closing is dirty-guarded too — unsaved edits prompt the confirm bar first.
  function attemptClose(): void {
    guard(() => requestClose());
  }
  closeRef.current = attemptClose;

  // Resolve a pending confirm: optionally save, then run the deferred action.
  function resolveConfirm(saveFirst: boolean): void {
    if (!confirming) return;
    const run = confirming.run;
    if (saveFirst) save();
    setConfirming(null);
    run();
  }

  // Portal to <body> so the overlay escapes every containing block — notably
  // the cockpit's `backdrop-filter` (and any transformed chat-stream ancestor),
  // which would otherwise trap `position: fixed` and confine the lightbox to
  // that subtree instead of the viewport.
  return createPortal(
    <dialog className="lightbox-root" aria-modal="true" open>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: the keyboard handler in the useEffect above already handles Escape; click on backdrop is a mouse shortcut */}
      <div className="lightbox-backdrop" onClick={attemptClose} />
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
                void copyText(draft);
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
              onClick={() => downloadText(draft, formatToExtension(item.fileName, format))}
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
          {editable && (
            <button
              type="button"
              className="lightbox-btn"
              disabled={!dirty}
              onClick={() => setDraft(baseline)}
            >
              Undo
            </button>
          )}
          {editable && (
            <button type="button" className="lightbox-btn" disabled={!dirty} onClick={save}>
              Save
            </button>
          )}
          <button type="button" className="lightbox-x" aria-label="Close" onClick={attemptClose}>
            ×
          </button>
        </div>
        <div className="lightbox-body">
          {item.kind === 'image' ? (
            <img className="lightbox-img" src={item.imageUrl} alt={item.fileName} />
          ) : (
            <LightboxTextBody item={item} format={format} draft={draft} onDraftChange={setDraft} />
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
        {confirming && (
          <div className="lightbox-confirm" role="alertdialog" aria-label="Unsaved changes">
            <span>Unsaved changes</span>
            <span className="lightbox-spacer" />
            <button type="button" className="lightbox-btn" onClick={() => resolveConfirm(true)}>
              Save
            </button>
            <button
              type="button"
              className="lightbox-btn lightbox-danger"
              onClick={() => resolveConfirm(false)}
            >
              Discard
            </button>
            <button type="button" className="lightbox-btn" onClick={() => setConfirming(null)}>
              Cancel
            </button>
          </div>
        )}
      </div>
    </dialog>,
    document.body,
  );
}
