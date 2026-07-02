// SPDX-License-Identifier: AGPL-3.0-only
import { probeServer } from '@chatsundere/ui-shared';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { JoinFormFields } from '../../../components/JoinFormFields.js';
import { isValidCode } from '../../../lib/code-input.js';
import { copy } from '../../../lib/copy.js';
import { isValidServerUrl } from '../../../lib/server-url.js';
import { useOnboardingStore } from '../../../state/onboarding.store.js';

/**
 * `/onboarding/pairing` — form screen for the pairing join path.
 * Variant C per spec § 4.3: URL + Code fields first, with Scan QR
 * as a visually-separated alternative below the primary "Continue" CTA.
 */
export function PairingForm() {
  const navigate = useNavigate();
  const setOnboardingState = useOnboardingStore((s) => s.setState);
  // Read initial values from the store once on mount via the lazy useState
  // initialiser — a subscribed selector that returns a fresh object literal
  // each call triggers an infinite useSyncExternalStore loop. We only need the
  // initial value here, not reactivity.
  const [baseUrl, setBaseUrl] = useState(() => {
    const s = useOnboardingStore.getState().state;
    return s.kind === 'pairing_input' || s.kind === 'pairing_confirm' ? s.baseUrl : '';
  });
  const [code, setCode] = useState(() => {
    const s = useOnboardingStore.getState().state;
    return s.kind === 'pairing_input' || s.kind === 'pairing_confirm' ? s.code : '';
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
      setOnboardingState({ kind: 'pairing_input', baseUrl, code });
      navigate('/onboarding/pairing/confirm');
    } finally {
      setProbing(false);
    }
  }

  return (
    <main className="mx-auto min-h-dvh w-full max-w-sm px-6 py-6">
      <Link to="/onboarding" aria-label="Back" className="text-2xl text-paper-soft">
        ←
      </Link>

      <h1 className="mt-4 font-display text-3xl italic">Add this device</h1>
      <p className="mt-1 text-sm text-paper-soft">
        Enter the URL and pairing code from your other device.
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

      {/* Structural break — see spec § 4.3. */}
      <div className="mt-8 flex items-center gap-3" aria-hidden>
        <div className="h-px flex-1 bg-aurora-700/40" />
        <span className="text-xs uppercase tracking-wider text-paper-soft">or</span>
        <div className="h-px flex-1 bg-aurora-700/40" />
      </div>

      <Link
        to="/onboarding/pairing/scan"
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-[var(--radius-card)] border border-aurora-700 px-4 py-3 text-sm font-medium text-paper transition-opacity hover:opacity-90"
      >
        {/* Camera icon slot — styling pass adds a real icon. */}
        <span aria-hidden className="h-4 w-4 rounded bg-aurora-700/40" />
        <span>Scan QR code</span>
      </Link>
    </main>
  );
}
