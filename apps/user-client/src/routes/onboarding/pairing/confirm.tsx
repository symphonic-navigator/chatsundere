// SPDX-License-Identifier: AGPL-3.0-only
import {
  CryptoError,
  finishJoinByPairing,
  getLinkedAccount,
  setBiometricPromptDue,
  startJoinByPairing,
} from '@chatsundere/crypto';
import {
  maybeProbeLinkedServer,
  useAccountLinkStore,
  useConnectivityStore,
  useSessionStore,
} from '@chatsundere/ui-shared';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getDb } from '../../../boot/open-db.js';
import { PassphraseField } from '../../../components/PassphraseField.js';
import { HttpError } from '../../../lib/fetch.js';
import { httpServerClient } from '../../../lib/server-client.js';
import { useOnboardingStore } from '../../../state/onboarding.store.js';

// ── Screen state ──────────────────────────────────────────────────────────────

type Screen =
  | { kind: 'ready' }
  | { kind: 'submitting' }
  | { kind: 'kind_mismatch' }
  | { kind: 'fatal'; message: string };

// ── Guard component ───────────────────────────────────────────────────────────

/**
 * `/onboarding/pairing/confirm` — Variant C confirm screen for the pairing
 * path. Per spec § 4.3: no username field (server returns it), no recovery
 * reveal afterwards (recovery already exists). On Continue, runs OPAQUE
 * login start + finish back-to-back and lands the user in /app.
 *
 * No late-link branch for pairing — the crypto layer refuses to overwrite an
 * existing local account: `finishJoinByPairing` (join-by-pairing.ts:152) throws
 * before any server call when a `local_account` row already exists.
 */
export function PairingConfirm() {
  const navigate = useNavigate();
  const onboardingState = useOnboardingStore((s) => s.state);

  const needsBounce =
    onboardingState.kind !== 'pairing_input' && onboardingState.kind !== 'pairing_confirm';

  // Bounce guard via useEffect — calling navigate() during render triggers
  // React's "setState while rendering" warning and can crash routing.
  useEffect(() => {
    if (needsBounce) navigate('/onboarding/pairing', { replace: true });
  }, [needsBounce, navigate]);

  if (needsBounce) return null;
  return <PairingConfirmInner />;
}

// ── Inner component ───────────────────────────────────────────────────────────

function PairingConfirmInner() {
  const navigate = useNavigate();
  const onboardingState = useOnboardingStore((s) => s.state);
  const setOnboardingState = useOnboardingStore((s) => s.setState);

  // The store is guaranteed to be pairing_input or pairing_confirm here
  // (enforced by the guard above), so this cast is safe.
  const storeCtx = onboardingState as Extract<
    typeof onboardingState,
    { kind: 'pairing_input' | 'pairing_confirm' }
  >;

  const [passphrase, setPassphrase] = useState('');
  const [passphraseError, setPassphraseError] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>({ kind: 'ready' });

  // ── Submit ────────────────────────────────────────────────────────────────────

  async function handleContinue() {
    setPassphraseError(null);

    if (passphrase.length === 0) {
      setPassphraseError('Enter your passphrase.');
      return;
    }

    setScreen({ kind: 'submitting' });

    try {
      // Both OPAQUE rounds run on the same submit so the same passphrase is
      // used for start and finish — running start earlier with an empty
      // passphrase would produce a broken OPAQUE record.
      const joinState = await startJoinByPairing({
        serverClient: httpServerClient,
        baseUrl: storeCtx.baseUrl,
        code: storeCtx.code,
        passphrase,
      });

      const result = await finishJoinByPairing({
        db: getDb(),
        serverClient: httpServerClient,
        baseUrl: storeCtx.baseUrl,
        joinState,
        passphrase,
        issuerLabel: null,
      });

      useConnectivityStore.getState().onServerOk();
      useSessionStore.getState().setSession(result.session, result.mk);
      useOnboardingStore.getState().reset();
      await setBiometricPromptDue(getDb());
      const linkedRow = await getLinkedAccount(getDb());
      if (linkedRow) useAccountLinkStore.getState().setLinked(linkedRow);
      // The device is now linked, so this probe (unlike any earlier onboarding
      // probe) actually populates the discovery store — the sync engine's
      // canRunCycle() would otherwise no-op until a reload or connectivity
      // event happens to fire, leaving a freshly-paired device in an empty vault.
      maybeProbeLinkedServer();
      navigate('/app', { replace: true });
    } catch (err) {
      const mapped = mapError(err);
      if (mapped.kind === 'passphrase_inline') {
        setPassphraseError(mapped.message);
        setScreen({ kind: 'ready' });
        return;
      }
      setScreen(mapped.screen);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  if (screen.kind === 'kind_mismatch') {
    return (
      <main className="mx-auto min-h-dvh w-full max-w-sm px-6 py-6">
        <Link to="/onboarding/pairing" className="text-2xl text-paper-soft" aria-label="Back">
          ←
        </Link>
        <h1 className="mt-4 font-display text-2xl italic">This is an invitation code</h1>
        <p className="mt-2 text-sm text-paper-soft">
          The code you entered is for joining a server with an invitation, not for adding a device.
        </p>
        <button
          type="button"
          onClick={() => {
            setOnboardingState({
              kind: 'invitation_input',
              baseUrl: storeCtx.baseUrl,
              code: storeCtx.code,
            });
            navigate('/onboarding/invitation', { replace: true });
          }}
          className="mt-6 w-full rounded-[var(--radius-card)] bg-aurora-700 px-4 py-3 text-sm font-medium text-paper transition-opacity hover:opacity-90"
        >
          Redeem invitation instead →
        </button>
      </main>
    );
  }

  if (screen.kind === 'fatal') {
    return (
      <main className="mx-auto min-h-dvh w-full max-w-sm px-6 py-6">
        <Link to="/onboarding/pairing" className="text-2xl text-paper-soft" aria-label="Back">
          ←
        </Link>
        <p className="mt-6 rounded-[var(--radius-card)] bg-danger/10 px-4 py-3 text-sm text-danger ring-1 ring-inset ring-danger/30">
          {screen.message}
        </p>
        <Link
          to="/onboarding/pairing"
          replace
          className="mt-4 inline-block text-sm text-paper-soft underline-offset-2 hover:text-paper hover:underline"
        >
          Try again
        </Link>
      </main>
    );
  }

  // ready or submitting
  const submitting = screen.kind === 'submitting';

  return (
    <main className="mx-auto min-h-dvh w-full max-w-sm px-6 py-6">
      <Link to="/onboarding/pairing" className="text-2xl text-paper-soft" aria-label="Back">
        ←
      </Link>
      <h1 className="mt-4 font-display text-3xl italic">Add this device</h1>
      <p className="mt-2 text-sm text-paper-soft">
        Enter the passphrase you use on your other device.
      </p>

      <dl className="mt-4 rounded-[var(--radius-card)] bg-ink-soft px-4 py-3 ring-1 ring-inset ring-aurora-700/20">
        <div className="flex justify-between gap-4">
          <dt className="text-xs uppercase tracking-wider text-paper-soft">Server</dt>
          <dd className="truncate font-mono text-sm">{storeCtx.baseUrl}</dd>
        </div>
      </dl>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void handleContinue();
        }}
        className="mt-4"
      >
        <PassphraseField
          id="pairing-passphrase"
          label="Your passphrase"
          value={passphrase}
          onChange={(v) => {
            setPassphrase(v);
            if (passphraseError) setPassphraseError(null);
          }}
          autoComplete="current-password"
        />
        {passphraseError && (
          <p role="alert" className="mt-1 text-sm text-danger">
            {passphraseError}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="mt-6 w-full rounded-[var(--radius-card)] bg-aurora-700 px-4 py-3 text-sm font-medium text-paper transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {submitting ? 'Working…' : 'Add this device'}
        </button>
      </form>
    </main>
  );
}

// ── Error mapping ─────────────────────────────────────────────────────────────

type Mapped =
  | { kind: 'passphrase_inline'; message: string }
  | { kind: 'screen'; screen: Extract<Screen, { kind: 'kind_mismatch' | 'fatal' }> };

function mapError(err: unknown): Mapped {
  if (err instanceof HttpError) {
    if (err.code === 'kind_mismatch') return { kind: 'screen', screen: { kind: 'kind_mismatch' } };
    if (err.code === 'opaque_evidence_invalid')
      return { kind: 'passphrase_inline', message: 'Wrong passphrase.' };
    if (err.code === 'code_not_found_or_expired')
      return {
        kind: 'screen',
        screen: {
          kind: 'fatal',
          message: 'Code not recognised. It may have expired, been used, or contain a typo.',
        },
      };
    if (err.code === 'rate_limit_exceeded')
      return {
        kind: 'screen',
        screen: { kind: 'fatal', message: 'Too many attempts. Please wait a minute.' },
      };
    if (err.code === 'wrapping_invariant_violated')
      return {
        kind: 'screen',
        screen: {
          kind: 'fatal',
          message: 'Cannot complete pairing. Please contact your operator.',
        },
      };
    if (err.status >= 500 || err.status === 0)
      return {
        kind: 'screen',
        screen: { kind: 'fatal', message: 'Server unreachable. Check your connection.' },
      };
  }
  if (err instanceof CryptoError && err.code === 'conflict') {
    return {
      kind: 'screen',
      screen: {
        kind: 'fatal',
        message: 'A local account already exists on this device.',
      },
    };
  }
  return {
    kind: 'screen',
    screen: { kind: 'fatal', message: 'Something went wrong. Please try again.' },
  };
}
