// SPDX-License-Identifier: AGPL-3.0-only
import { probeServer } from '@chatsundere/ui-shared';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { JoinFormFields } from '../../../components/JoinFormFields.js';
import { isValidCode } from '../../../lib/code-input.js';
import { copy } from '../../../lib/copy.js';
import { isValidServerUrl } from '../../../lib/server-url.js';
import { useOnboardingStore } from '../../../state/onboarding.store.js';
import { InvitationAccountGuard } from './_account-guard.js';
import { useNavTarget, useReturnUrl } from './_return-url.js';

/**
 * `/onboarding/invitation` — form screen for the invitation join path.
 * Variant C per spec § 2 Decision 3: URL + Code fields first, with Scan QR
 * as a visually-separated alternative below the primary "Continue" CTA.
 *
 * Wrapped in the account-guard (spec §4.1): a device that already holds a
 * local account with no unlocked session is routed through the local login
 * first, so the join becomes a late-link rather than minting a fresh MK.
 */
export function InvitationForm() {
  return (
    <InvitationAccountGuard>
      <InvitationFormInner />
    </InvitationAccountGuard>
  );
}

function InvitationFormInner() {
  const navigate = useNavigate();
  const returnUrl = useReturnUrl();
  const navTarget = useNavTarget();
  const setOnboardingState = useOnboardingStore((s) => s.setState);
  // Read initial values from the store once on mount via the lazy useState
  // initialiser. A subscribed selector that returns a fresh object literal each
  // call triggers an infinite useSyncExternalStore loop (the snapshot is never
  // referentially equal to itself); we only need the initial value here, not
  // reactivity, so no subscription is required.
  const [baseUrl, setBaseUrl] = useState(() => {
    const s = useOnboardingStore.getState().state;
    return s.kind === 'invitation_input' || s.kind === 'invitation_confirm' ? s.baseUrl : '';
  });
  const [code, setCode] = useState(() => {
    const s = useOnboardingStore.getState().state;
    return s.kind === 'invitation_input' || s.kind === 'invitation_confirm' ? s.code : '';
  });

  const [probing, setProbing] = useState(false);
  const [probeError, setProbeError] = useState<string | null>(null);

  const urlValid = isValidServerUrl(baseUrl);
  const codeValid = isValidCode(code);
  const continueEnabled = urlValid && codeValid;

  async function handleContinue() {
    if (!continueEnabled || probing) return;
    setProbeError(null);
    setProbing(true);
    try {
      const probe = await probeServer(baseUrl);
      if (probe.kind === 'unreachable') {
        setProbeError(copy.onboardingProbe.unreachable);
        return;
      }
      if (probe.kind === 'invalid') {
        setProbeError(copy.onboardingProbe.invalid);
        return;
      }
      setOnboardingState({ kind: 'invitation_input', baseUrl, code });
      navigate(navTarget('/onboarding/invitation/confirm'));
    } finally {
      setProbing(false);
    }
  }

  return (
    <main className="mx-auto min-h-dvh w-full max-w-sm px-6 py-6">
      <Link to={returnUrl} aria-label="Back" className="text-2xl text-paper-soft">
        ←
      </Link>

      <h1 className="mt-4 font-display text-3xl italic">Redeem your invitation</h1>
      <p className="mt-1 text-sm text-paper-soft">
        Enter the server URL and the code your operator gave you.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void handleContinue();
        }}
        className="mt-6"
      >
        <JoinFormFields
          baseUrl={baseUrl}
          code={code}
          onBaseUrlChange={setBaseUrl}
          onCodeChange={setCode}
        />

        {probeError && (
          <p role="alert" className="mt-2 text-sm text-danger">
            {probeError}
          </p>
        )}

        <button
          type="submit"
          disabled={!continueEnabled || probing}
          className="mt-6 w-full rounded-[var(--radius-card)] bg-aurora-700 px-4 py-3 text-sm font-medium text-paper transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {probing ? copy.onboardingProbe.checking : 'Continue'}
        </button>
      </form>

      {/* Structural break — see spec § 2 Decision 3. */}
      <div className="mt-8 flex items-center gap-3" aria-hidden>
        <div className="h-px flex-1 bg-aurora-700/40" />
        <span className="text-xs uppercase tracking-wider text-paper-soft">or</span>
        <div className="h-px flex-1 bg-aurora-700/40" />
      </div>

      <Link
        to={navTarget('/onboarding/invitation/scan')}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-[var(--radius-card)] border border-aurora-700 px-4 py-3 text-sm font-medium text-paper transition-opacity hover:opacity-90"
      >
        {/* Camera icon slot — styling pass adds a real icon. */}
        <span aria-hidden className="h-4 w-4 rounded bg-aurora-700/40" />
        <span>Scan QR code</span>
      </Link>
    </main>
  );
}
