// SPDX-License-Identifier: LGPL-3.0-only

import type { PasskeyStepUpOutcome, PassphraseStepUpOutcome } from '@chatsundere/crypto';
import { useEffect, useRef, useState } from 'react';
import { resolveStepUp, useStepUpStore } from '../state/step-up.store.js';

export interface StepUpModalCopy {
  title: string;
  bodyBoth: string;
  bodyPassphraseOnly: string;
  usePasskeyCta: string;
  usePassphraseCta: string;
  passphraseLabel: string;
  confirmCta: string;
  cancelCta: string;
  passkeyFailed: string;
  wrongPassphrase: string;
  genericError: string;
  busy: string;
}

export interface StepUpModalProps {
  /** Whether a server-synced passkey exists — the admin-client passes false. */
  passkeyAvailable: boolean;
  onPasskey?: () => Promise<PasskeyStepUpOutcome>;
  onPassphrase: (passphrase: string) => Promise<PassphraseStepUpOutcome>;
  copy: StepUpModalCopy;
}

type View = { kind: 'choice' } | { kind: 'passphrase'; notice: string | null } | { kind: 'busy' };

/**
 * The step-up confirmation modal (ADR 0027, step-up brief §UX Patterns).
 * Subscribes to the step-up store; mounts once per app root. Mechanism
 * handlers are injected so this component carries no crypto imports.
 * Method-agnostic, tier-agnostic copy; the silent A→B fall-through lives
 * here (no_passkey / uv_required never surface as errors — spec §7.2).
 */
export function StepUpModal({ passkeyAvailable, onPasskey, onPassphrase, copy }: StepUpModalProps) {
  const pending = useStepUpStore((s) => s.pending);
  const open = pending !== null;
  const canUsePasskey = passkeyAvailable && onPasskey !== undefined;

  const dialogRef = useRef<HTMLDialogElement>(null);
  const [view, setView] = useState<View>({ kind: 'choice' });
  const [passphrase, setPassphrase] = useState('');

  useEffect(() => {
    const el = dialogRef.current;
    if (!el) return;
    if (open) {
      setView(canUsePasskey ? { kind: 'choice' } : { kind: 'passphrase', notice: null });
      setPassphrase('');
      if (!el.open) el.showModal();
    } else if (el.open) {
      el.close();
    }
  }, [open, canUsePasskey]);

  function cancel() {
    resolveStepUp(false);
  }

  async function handlePasskey() {
    if (!onPasskey) return;
    setView({ kind: 'busy' });
    const outcome = await onPasskey();
    if (outcome === 'confirmed') {
      resolveStepUp(true);
      return;
    }
    // no_passkey / uv_required: silent fall-through; hard failure gets a notice.
    setView({
      kind: 'passphrase',
      notice: outcome === 'failed' ? copy.passkeyFailed : null,
    });
  }

  async function handlePassphrase() {
    if (passphrase.length === 0) return;
    setView({ kind: 'busy' });
    const outcome = await onPassphrase(passphrase);
    if (outcome === 'confirmed') {
      resolveStepUp(true);
      return;
    }
    setPassphrase('');
    setView({
      kind: 'passphrase',
      notice: outcome === 'wrong_passphrase' ? copy.wrongPassphrase : copy.genericError,
    });
  }

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      aria-label={copy.title}
      onCancel={(e) => {
        e.preventDefault();
        cancel();
      }}
      className="w-full max-w-sm rounded-lg bg-inherit p-0 text-inherit backdrop:bg-black/50"
    >
      <div className="px-5 py-4">
        <h2 className="text-lg font-medium">{copy.title}</h2>

        {view.kind === 'choice' && (
          <>
            <p className="mt-1 text-sm opacity-80">{copy.bodyBoth}</p>
            <div className="mt-4 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => void handlePasskey()}
                className="rounded-md px-4 py-2.5 text-sm font-medium ring-1 ring-inset ring-current"
              >
                {copy.usePasskeyCta}
              </button>
              <button
                type="button"
                onClick={() => setView({ kind: 'passphrase', notice: null })}
                className="rounded-md px-4 py-2.5 text-sm opacity-80"
              >
                {copy.usePassphraseCta}
              </button>
            </div>
          </>
        )}

        {view.kind === 'passphrase' && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handlePassphrase();
            }}
          >
            <p className="mt-1 text-sm opacity-80">{copy.bodyPassphraseOnly}</p>
            {view.notice && (
              <p role="alert" className="mt-2 text-sm text-red-500">
                {view.notice}
              </p>
            )}
            <label
              className="mt-3 block text-xs font-medium uppercase tracking-wider opacity-70"
              htmlFor="step-up-passphrase"
            >
              {copy.passphraseLabel}
            </label>
            <input
              id="step-up-passphrase"
              type="password"
              autoComplete="current-password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
              className="mt-1 w-full rounded-md bg-transparent px-3 py-2 ring-1 ring-inset ring-current/40 focus:outline-none"
            />
            <div className="mt-4 flex justify-end gap-3">
              <button
                type="button"
                onClick={cancel}
                className="rounded-md px-4 py-2 text-sm opacity-80"
              >
                {copy.cancelCta}
              </button>
              <button
                type="submit"
                disabled={passphrase.length === 0}
                className="rounded-md px-4 py-2 text-sm font-medium ring-1 ring-inset ring-current disabled:opacity-40"
              >
                {copy.confirmCta}
              </button>
            </div>
          </form>
        )}

        {view.kind === 'busy' && <p className="mt-3 text-sm opacity-80">{copy.busy}</p>}

        {view.kind === 'choice' && (
          <button
            type="button"
            onClick={cancel}
            className="mt-3 w-full rounded-md px-4 py-2 text-sm opacity-70"
          >
            {copy.cancelCta}
          </button>
        )}
      </div>
    </dialog>
  );
}
