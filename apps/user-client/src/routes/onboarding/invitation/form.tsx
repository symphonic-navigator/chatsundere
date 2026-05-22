// SPDX-License-Identifier: AGPL-3.0-only
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { JoinFormFields } from '../../../components/JoinFormFields.js';
import { isValidCode } from '../../../lib/code-input.js';
import { isValidServerUrl } from '../../../lib/server-url.js';
import { useOnboardingStore } from '../../../state/onboarding.store.js';

/**
 * `/onboarding/invitation` — form screen for the invitation join path.
 * Variant C per spec § 2 Decision 3: URL + Code fields first, with Scan QR
 * as a visually-separated alternative below the primary "Continue" CTA.
 */
export function InvitationForm() {
  const navigate = useNavigate();
  const setOnboardingState = useOnboardingStore((s) => s.setState);
  const stored = useOnboardingStore((s) =>
    s.state.kind === 'invitation_input' || s.state.kind === 'invitation_confirm'
      ? { baseUrl: s.state.baseUrl, code: s.state.code }
      : { baseUrl: '', code: '' },
  );
  const [baseUrl, setBaseUrl] = useState(stored.baseUrl);
  const [code, setCode] = useState(stored.code);

  const urlValid = isValidServerUrl(baseUrl);
  const codeValid = isValidCode(code);
  const continueEnabled = urlValid && codeValid;

  function handleContinue() {
    if (!continueEnabled) return;
    setOnboardingState({ kind: 'invitation_input', baseUrl, code });
    navigate('/onboarding/invitation/confirm');
  }

  return (
    <main className="mx-auto min-h-dvh w-full max-w-sm px-6 py-6">
      <Link to="/onboarding" aria-label="Back" className="text-2xl text-paper-soft">
        ←
      </Link>

      <h1 className="mt-4 font-display text-3xl italic">Redeem your invitation</h1>
      <p className="mt-1 text-sm text-paper-soft">
        Enter the server URL and the code your operator gave you.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleContinue();
        }}
        className="mt-6"
      >
        <JoinFormFields
          baseUrl={baseUrl}
          code={code}
          onBaseUrlChange={setBaseUrl}
          onCodeChange={setCode}
        />

        <button
          type="submit"
          disabled={!continueEnabled}
          className="mt-6 w-full rounded-[var(--radius-card)] bg-aurora-700 px-4 py-3 text-sm font-medium text-paper transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Continue
        </button>
      </form>

      {/* Structural break — see spec § 2 Decision 3. */}
      <div className="mt-8 flex items-center gap-3" aria-hidden>
        <div className="h-px flex-1 bg-aurora-700/40" />
        <span className="text-xs uppercase tracking-wider text-paper-soft">or</span>
        <div className="h-px flex-1 bg-aurora-700/40" />
      </div>

      <Link
        to="/onboarding/invitation/scan"
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-[var(--radius-card)] border border-aurora-700 px-4 py-3 text-sm font-medium text-paper transition-opacity hover:opacity-90"
      >
        {/* Camera icon slot — styling pass adds a real icon. */}
        <span aria-hidden className="h-4 w-4 rounded bg-aurora-700/40" />
        <span>Scan QR code</span>
      </Link>
    </main>
  );
}
