// SPDX-License-Identifier: AGPL-3.0-only

import { getBiometricPromptShown, setBiometricPromptShown } from '@chatsundere/crypto';
import { useSessionStore } from '@chatsundere/ui-shared';
import { useEffect, useState } from 'react';
import { getDb } from '../boot/open-db.js';
import { copy } from '../lib/copy.js';
import { StartUnreachableError, registerServerSyncedPasskey } from '../lib/server-passkey.js';
import { isWebAuthnAvailable } from '../lib/webauthn-availability.js';
import { PrfRequiredError, registerLocalBiometric } from '../lib/webauthn.js';

type PromptState =
  | { kind: 'checking' }
  | { kind: 'hidden' }
  | { kind: 'visible' }
  | { kind: 'busy' }
  | { kind: 'fallback-info' }
  | { kind: 'error'; message: string };

/**
 * Post-onboarding biometric setup prompt.
 *
 * Shown once, inline, after the user first lands in `/app` following a
 * linked-mode join (invitation, pairing, or recovery-from-scratch). Local-only
 * users never see it — biometric setup for them is only available in Settings.
 *
 * The "prompt due" flag is written by the join/link flows and cleared here
 * on dismiss or completion. Once cleared it never appears again.
 */
export function PostOnboardingBiometricPrompt() {
  const session = useSessionStore((s) => s.session);
  const [state, setState] = useState<PromptState>({ kind: 'checking' });

  useEffect(() => {
    // Only linked-mode sessions are eligible.
    if (!session || session.mode !== 'linked') {
      setState({ kind: 'hidden' });
      return;
    }
    // No WebAuthn support on this device — nothing to offer.
    if (!isWebAuthnAvailable()) {
      setState({ kind: 'hidden' });
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const shown = await getBiometricPromptShown(getDb());
        if (cancelled) return;
        setState(shown ? { kind: 'hidden' } : { kind: 'visible' });
      } catch {
        if (!cancelled) setState({ kind: 'hidden' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session]);

  async function handleSetUpNow() {
    setState({ kind: 'busy' });
    try {
      if (session?.mode === 'linked') {
        const result = await registerServerSyncedPasskey(copy.biometricPrompt.defaultLabel);
        await setBiometricPromptShown(getDb());
        if (result === 'local-fallback') {
          setState({ kind: 'fallback-info' });
          return;
        }
        setState({ kind: 'hidden' });
        return;
      }
      await registerLocalBiometric(copy.biometricPrompt.defaultLabel);
      await setBiometricPromptShown(getDb());
      setState({ kind: 'hidden' });
    } catch (e) {
      // Server unreachable before any credential was minted — leave the prompt
      // dismissable and do NOT mark it shown, so a retry is possible.
      if (e instanceof StartUnreachableError) {
        setState({ kind: 'error', message: copy.biometricPrompt.startUnreachable });
        return;
      }
      // User-cancelled gesture (Esc, system dismiss) — back to visible, no error.
      if (e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'AbortError')) {
        setState({ kind: 'visible' });
        return;
      }
      const message =
        e instanceof PrfRequiredError
          ? copy.biometricPrompt.prfRequired
          : copy.biometricPrompt.genericError;
      setState({ kind: 'error', message });
    }
  }

  async function handleMaybeLater() {
    try {
      await setBiometricPromptShown(getDb());
    } catch {
      // Best-effort — even if the write fails, hide the prompt for this session.
    }
    setState({ kind: 'hidden' });
  }

  if (state.kind === 'checking' || state.kind === 'hidden') return null;

  const busy = state.kind === 'busy';

  // The credential was created locally but couldn't be synced to the server —
  // acknowledge it and move on. Same card, a single dismiss action.
  if (state.kind === 'fallback-info') {
    return (
      <dialog
        open
        aria-label={copy.biometricPrompt.title}
        className="static mx-auto w-full max-w-sm rounded-[var(--radius-card)] bg-ink-soft px-5 py-4 ring-1 ring-inset ring-aurora-700/30"
      >
        <h2 className="font-display text-lg italic text-paper">{copy.biometricPrompt.title}</h2>
        <p className="mt-1 text-sm text-paper-soft">{copy.biometricPrompt.localFallback}</p>
        <div className="mt-4 flex">
          <button
            type="button"
            onClick={() => setState({ kind: 'hidden' })}
            className="flex-1 rounded-[var(--radius-card)] bg-aurora-700 px-4 py-2.5 text-sm font-medium text-paper transition-opacity hover:opacity-90"
          >
            {copy.biometricPrompt.fallbackOkCta}
          </button>
        </div>
      </dialog>
    );
  }

  return (
    <dialog
      open
      aria-label={copy.biometricPrompt.title}
      className="static mx-auto w-full max-w-sm rounded-[var(--radius-card)] bg-ink-soft px-5 py-4 ring-1 ring-inset ring-aurora-700/30"
    >
      <h2 className="font-display text-lg italic text-paper">{copy.biometricPrompt.title}</h2>
      <p className="mt-1 text-sm text-paper-soft">{copy.biometricPrompt.body}</p>

      {state.kind === 'error' && <p className="mt-2 text-xs text-danger">{state.message}</p>}

      <div className="mt-4 flex gap-3">
        <button
          type="button"
          onClick={() => void handleSetUpNow()}
          disabled={busy}
          className="flex-1 rounded-[var(--radius-card)] bg-aurora-700 px-4 py-2.5 text-sm font-medium text-paper transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? copy.biometricPrompt.busyCta : copy.biometricPrompt.setupCta}
        </button>
        <button
          type="button"
          onClick={() => void handleMaybeLater()}
          disabled={busy}
          className="flex-1 rounded-[var(--radius-card)] bg-ink px-4 py-2.5 text-sm font-medium text-paper-soft ring-1 ring-inset ring-aurora-700/30 transition-opacity hover:text-paper disabled:opacity-40"
        >
          {copy.biometricPrompt.laterCta}
        </button>
      </div>
    </dialog>
  );
}
