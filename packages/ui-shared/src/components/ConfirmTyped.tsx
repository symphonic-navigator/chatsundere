// SPDX-License-Identifier: LGPL-3.0-only

import { useEffect, useRef, useState } from 'react';

export interface ConfirmTypedProps {
  open: boolean;
  title: string;
  body: string;
  /** The exact string the user must type to enable the destructive CTA. */
  confirmToken: string;
  /** Describes what the user must type, e.g. "your username" or "delete chatsundere". */
  confirmTokenLabel: string;
  destructiveCta: string;
  cancelCta: string;
  onCancel(): void;
  onConfirm(): void;
  busy?: boolean;
  /**
   * When true, the cancel button wears the gold priority treatment ("gold protects, never invites").
   * The destructive button stays red regardless.
   * Default false — existing callers unchanged.
   */
  protectCancel?: boolean;
}

/**
 * Modal dialog that gates a destructive action behind a typed confirmation.
 * The destructive button is disabled until the user types `confirmToken` exactly.
 *
 * Uses the native `<dialog>` element for correct accessibility semantics and
 * built-in focus-trap behaviour. Pressing Escape triggers `onCancel`.
 */
export function ConfirmTyped({
  open,
  title,
  body,
  confirmToken,
  confirmTokenLabel,
  destructiveCta,
  cancelCta,
  onCancel,
  onConfirm,
  busy = false,
  protectCancel = false,
}: ConfirmTypedProps) {
  const [typed, setTyped] = useState('');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Open / close the native dialog imperatively.
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;

    if (open) {
      if (!el.open) el.showModal();
      setTyped('');
      // Defer focus so the element is visible first.
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      if (el.open) el.close();
    }
  }, [open]);

  // Map the native `cancel` event (Escape key) to onCancel.
  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    const handleCancel = (e: Event) => {
      e.preventDefault();
      onCancel();
    };
    el.addEventListener('cancel', handleCancel);
    return () => el.removeEventListener('cancel', handleCancel);
  }, [onCancel]);

  const confirmed = typed === confirmToken;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby="confirm-typed-title"
      className="m-auto w-full max-w-sm rounded-[var(--radius-card)] bg-ink-soft p-6 ring-1 ring-inset ring-aurora-700/40 backdrop:bg-ink/70 backdrop:backdrop-blur-sm"
    >
      <h2 id="confirm-typed-title" className="font-display text-xl italic text-paper">
        {title}
      </h2>
      <p className="mt-3 text-sm leading-relaxed text-paper-soft">{body}</p>

      <div className="mt-5 space-y-2">
        <label htmlFor="confirm-typed-input" className="block text-xs text-paper-soft">
          Type <span className="text-paper">{confirmTokenLabel}</span> to confirm
        </label>
        <input
          ref={inputRef}
          id="confirm-typed-input"
          type="text"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="none"
          spellCheck={false}
          disabled={busy}
          className="w-full rounded-[var(--radius-input)] bg-ink px-3 py-2 font-mono text-sm text-paper ring-1 ring-inset ring-aurora-700/40 placeholder:text-paper-soft/40 focus:outline-none focus:ring-aurora-500 disabled:opacity-50"
        />
      </div>

      <div className="mt-5 flex gap-3">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          data-priority={protectCancel ? 'true' : undefined}
          className={`flex-1 rounded-[var(--radius-card)] px-4 py-2.5 text-sm font-medium transition-opacity disabled:opacity-40${protectCancel ? ' hover:opacity-90 ring-0' : ' bg-ink text-paper-soft ring-1 ring-inset ring-aurora-700/30 hover:opacity-80'}`}
          style={
            protectCancel
              ? {
                  backgroundImage:
                    'linear-gradient(180deg, var(--color-gold-hi), var(--color-gold-lo))',
                  color: '#1a1407',
                  borderColor: 'color-mix(in srgb, var(--color-gold) 70%, transparent)',
                }
              : undefined
          }
        >
          {cancelCta}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={!confirmed || busy}
          className="flex-1 rounded-[var(--radius-card)] bg-danger px-4 py-2.5 text-sm font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {busy ? 'Working…' : destructiveCta}
        </button>
      </div>
    </dialog>
  );
}
