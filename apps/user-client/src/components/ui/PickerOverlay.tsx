// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { computeTransformOrigin } from '../../lib/origin-zoom.js';
import { Button } from './Button.js';
import { ConfirmDialog } from './ConfirmDialog.js';

export interface PickerOverlayProps {
  open: boolean;
  title: string; // "what is being picked"
  onClose: () => void; // dismiss (cancel); discard-guarded when dirty
  /**
   * When set, ‹ calls this instead of onClose (step back).
   * NOT dirty-guarded by design — only the non-staging model picker uses it;
   * a future staged overlay must not wire onBack + dirty or it would silently
   * discard staged edits without raising the confirm.
   */
  onBack?: () => void;
  onSave?: () => void; // present → gold Save shown; absent → no Save
  saveDisabled?: boolean; // Save greyed until dirty
  dirty?: boolean; // true → dismissal raises a discard-changes confirm
  triggerRef?: React.RefObject<HTMLElement | null>; // zoom origin
  children: React.ReactNode;
}

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * The shared picker shell (spec §2): a zoom-from-trigger modal with a
 * `[‹] title [Save]` bar. Save is shown only when `onSave` is given (the model
 * picker self-closes instead). `‹` steps back via `onBack` when given, else
 * dismisses. Dismissing a `dirty` sheet first raises a Discard-changes confirm,
 * so a back-arrow never silently throws away staged edits (Laura SOFT-1).
 */
export function PickerOverlay({
  open,
  title,
  onClose,
  onBack,
  onSave,
  saveDisabled,
  dirty,
  triggerRef,
  children,
}: PickerOverlayProps): JSX.Element | null {
  const panelRef = useRef<HTMLDivElement>(null);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  // Refs so the keydown handler always reads current values without re-registering.
  const confirmingDiscardRef = useRef(false);
  const dirtyRef = useRef(dirty);
  const onCloseRef = useRef(onClose);

  // Keep refs in sync each render.
  confirmingDiscardRef.current = confirmingDiscard;
  dirtyRef.current = dirty;
  onCloseRef.current = onClose;

  // Reset the guard whenever the sheet (re)opens.
  useEffect(() => {
    if (open) setConfirmingDiscard(false);
  }, [open]);

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

  // When the discard confirm opens, move focus into it so keyboard users are not
  // stranded. The confirm is a sibling of the panel inside .cs-picker-root; reach
  // it via panelRef.current.parentElement so we don't need an extra ref on the root.
  // When the confirm closes (Keep editing), focus stays in the panel — no action needed.
  useEffect(() => {
    if (!confirmingDiscard) return;
    const root = panelRef.current?.parentElement;
    const card = root?.querySelector<HTMLElement>('.cs-dialog-card');
    const first = card?.querySelector<HTMLElement>(FOCUSABLE);
    if (first) first.focus();
  }, [confirmingDiscard]);

  // Focus management + Esc + a minimal focus trap (spec §2.3).
  // The keydown handler reads confirmingDiscard/dirty/onClose via refs so it
  // never goes stale and we don't need to re-register it (which would re-focus
  // the panel's first element) each time those values change. Deps: [open] only.
  useEffect(() => {
    if (!open) return undefined;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus();
    const onKey = (e: KeyboardEvent): void => {
      const isConfirming = confirmingDiscardRef.current;
      if (e.key === 'Escape') {
        // Let ConfirmDialog's own capture-phase handler process Esc when it is open.
        if (isConfirming) return;
        if (dirtyRef.current) setConfirmingDiscard(true);
        else onCloseRef.current();
        return;
      }
      if (e.key === 'Tab') {
        // Determine which surface owns the trap: the dialog card when the confirm
        // is up, the panel otherwise.
        const root = panel?.parentElement;
        const trapRoot = isConfirming ? root?.querySelector<HTMLElement>('.cs-dialog-card') : panel;
        if (!trapRoot) return;
        const nodes = Array.from(trapRoot.querySelectorAll<HTMLElement>(FOCUSABLE));
        if (nodes.length === 0) return;
        const firstNode = nodes[0];
        const lastNode = nodes[nodes.length - 1];
        if (!firstNode || !lastNode) return;
        const active = document.activeElement;
        if (e.shiftKey && active === firstNode) {
          e.preventDefault();
          lastNode.focus();
        } else if (!e.shiftKey && active === lastNode) {
          e.preventDefault();
          firstNode.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      previouslyFocused?.focus();
    };
  }, [open]);

  if (!open) return null;

  return (
    // biome-ignore lint/a11y/useSemanticElements: fixed stacking layer that drives CSS animation; <dialog> requires showModal() which conflicts with our zoom entry
    <div className="cs-picker-root" role="dialog" aria-modal="true" aria-label={title}>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop tap maps to dismiss; Escape is handled on window */}
      <div
        data-testid="cs-picker-backdrop"
        className="cs-picker-backdrop"
        onClick={() => {
          if (dirtyRef.current) setConfirmingDiscard(true);
          else onCloseRef.current();
        }}
        aria-hidden="true"
      />
      <div ref={panelRef} className="cs-picker-panel cs-zoom-in" tabIndex={-1}>
        <header className="cs-picker-titlebar">
          <button
            type="button"
            aria-label="Back"
            className="cs-picker-back"
            onClick={() =>
              onBack
                ? onBack()
                : dirtyRef.current
                  ? setConfirmingDiscard(true)
                  : onCloseRef.current()
            }
          >
            ‹
          </button>
          <h2 className="cs-picker-title">{title}</h2>
          {onSave ? (
            <Button tone="primary" priority disabled={saveDisabled} onClick={onSave}>
              Save
            </Button>
          ) : (
            <span className="cs-picker-save-spacer" aria-hidden="true" />
          )}
        </header>
        <div className="cs-picker-scroll">{children}</div>
      </div>
      <ConfirmDialog
        open={confirmingDiscard}
        title="Discard changes?"
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        destructive
        onConfirm={() => {
          setConfirmingDiscard(false);
          onClose();
        }}
        onCancel={() => setConfirmingDiscard(false)}
      />
    </div>
  );
}
