// SPDX-License-Identifier: AGPL-3.0-only
import {
  CryptoError,
  finishJoinByInvitation,
  linkToServer,
  setBiometricPromptDue,
  startJoinByInvitation,
} from '@chatsundere/crypto';
import { useConnectivityStore, useSessionStore } from '@chatsundere/ui-shared';
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
 * `/onboarding/invitation/confirm` — shows the server URL, an editable username
 * field, and a passphrase field. On submit it runs the full OPAQUE registration
 * round (start + finish) in one go, then dispatches:
 *
 * - **Fresh-PWA case** (no local session): `startJoinByInvitation` →
 *   `finishJoinByInvitation` → store recovery key → navigate to
 *   `/onboarding/invitation/recovery`.
 * - **Late-link case** (local session already exists): `linkToServer` → navigate
 *   directly to `/app`.
 *
 * OPAQUE protocol note: `startRegistration` blinds the passphrase; the finish
 * round must use the identical passphrase or the OPAQUE record will not verify.
 * Running start on mount with an empty passphrase and finish on submit with the
 * real passphrase would silently produce a broken record. Both rounds therefore
 * run together on submit.
 *
 * Per spec § 2 Decision 9: `kind_mismatch` is constructive — the user is offered
 * a button to switch to the pairing path with the code pre-filled.
 */
export function InvitationConfirm() {
  const navigate = useNavigate();
  const onboardingState = useOnboardingStore((s) => s.state);

  const needsBounce =
    onboardingState.kind !== 'invitation_input' && onboardingState.kind !== 'invitation_confirm';

  // ── Bounce guard ─────────────────────────────────────────────────────────────
  // If the store has no invitation context, the user navigated here directly.
  // Redirect to the form rather than rendering broken state. The navigate call
  // must run inside useEffect — calling it during render is a setState-during-
  // render bug that React warns about and that can crash routing.
  useEffect(() => {
    if (needsBounce) navigate('/onboarding/invitation', { replace: true });
  }, [needsBounce, navigate]);

  if (needsBounce) return null;
  return <InvitationConfirmInner />;
}

// ── Inner component ───────────────────────────────────────────────────────────

function InvitationConfirmInner() {
  const navigate = useNavigate();
  const onboardingState = useOnboardingStore((s) => s.state);
  const setOnboardingState = useOnboardingStore((s) => s.setState);

  // The store is guaranteed to be invitation_input or invitation_confirm here
  // (enforced by the guard above), so this cast is safe.
  const storeCtx = onboardingState as Extract<
    typeof onboardingState,
    { kind: 'invitation_input' | 'invitation_confirm' }
  >;

  const [username, setUsername] = useState(
    onboardingState.kind === 'invitation_confirm' ? (onboardingState.suggestedUsername ?? '') : '',
  );
  const [passphrase, setPassphrase] = useState('');
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [passphraseError, setPassphraseError] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>({ kind: 'ready' });

  const localSession = useSessionStore((s) => s.session);
  const localMk = useSessionStore((s) => s.mk);
  const isLateLink = !!localSession && !!localMk;

  // ── Submit ────────────────────────────────────────────────────────────────────

  async function handleContinue() {
    setUsernameError(null);
    setPassphraseError(null);

    if (!isLateLink && username.trim().length === 0) {
      setUsernameError('Pick a username.');
      return;
    }
    if (passphrase.length === 0) {
      setPassphraseError('Enter your passphrase.');
      return;
    }

    setScreen({ kind: 'submitting' });

    try {
      if (isLateLink) {
        // Late-link: the local account already has an MK and recovery key.
        // `linkToServer` runs its own OPAQUE round internally.
        await linkToServer({
          db: getDb(),
          serverClient: httpServerClient,
          invitationToken: storeCtx.code,
          baseUrl: storeCtx.baseUrl,
          issuerLabel: null,
          passphrase,
          mk: localMk,
        });
        useConnectivityStore.getState().onServerOk();
        // Preserve the existing MK by omitting the second argument.
        useSessionStore.getState().setSession({ ...localSession, mode: 'linked' });
        useOnboardingStore.getState().reset();
        await setBiometricPromptDue(getDb());
        navigate('/app', { replace: true });
      } else {
        // Fresh-PWA: run start + finish in one go so the same passphrase is
        // used for both OPAQUE rounds (start must match finish).
        const joinState = await startJoinByInvitation({
          serverClient: httpServerClient,
          baseUrl: storeCtx.baseUrl,
          code: storeCtx.code,
          passphrase,
        });

        const result = await finishJoinByInvitation({
          db: getDb(),
          serverClient: httpServerClient,
          baseUrl: storeCtx.baseUrl,
          joinState,
          username: username.trim(),
          passphrase,
          issuerLabel: null,
        });

        useConnectivityStore.getState().onServerOk();
        useSessionStore.getState().setSession(result.session, result.mk);
        setOnboardingState({
          kind: 'invitation_recovery',
          userId: result.session.userId,
          username: result.session.username,
          recoveryKeyString: result.recoveryKeyString,
        });
        await setBiometricPromptDue(getDb());
        navigate('/onboarding/invitation/recovery', { replace: true });
      }
    } catch (err) {
      const mapped = mapSubmitError(err);
      if (mapped.kind === 'username_inline') {
        setUsernameError(mapped.message);
        setScreen({ kind: 'ready' });
        return;
      }
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
        <Link to="/onboarding/invitation" className="text-2xl text-paper-soft" aria-label="Back">
          ←
        </Link>
        <h1 className="mt-4 font-display text-2xl italic">This is a different kind of code</h1>
        <p className="mt-2 text-sm text-paper-soft">
          The code you entered is for adding another device, not for joining a server with an
          invitation.
        </p>
        <button
          type="button"
          onClick={() => {
            setOnboardingState({
              kind: 'pairing_input',
              baseUrl: storeCtx.baseUrl,
              code: storeCtx.code,
            });
            navigate('/onboarding/pairing', { replace: true });
          }}
          className="mt-6 w-full rounded-[var(--radius-card)] bg-aurora-700 px-4 py-3 text-sm font-medium text-paper transition-opacity hover:opacity-90"
        >
          Add device instead →
        </button>
      </main>
    );
  }

  if (screen.kind === 'fatal') {
    return (
      <main className="mx-auto min-h-dvh w-full max-w-sm px-6 py-6">
        <Link to="/onboarding/invitation" className="text-2xl text-paper-soft" aria-label="Back">
          ←
        </Link>
        <p className="mt-6 rounded-[var(--radius-card)] bg-danger/10 px-4 py-3 text-sm text-danger ring-1 ring-inset ring-danger/30">
          {screen.message}
        </p>
        <Link
          to="/onboarding/invitation"
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
      <Link to="/onboarding/invitation" className="text-2xl text-paper-soft" aria-label="Back">
        ←
      </Link>
      <h1 className="mt-4 font-display text-3xl italic">Join this server</h1>

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
        {!isLateLink && (
          <div className="mb-4">
            <label
              htmlFor="confirm-username"
              className="block text-xs font-medium uppercase tracking-wider text-paper-soft"
            >
              Username
            </label>
            <input
              id="confirm-username"
              type="text"
              autoComplete="username"
              spellCheck={false}
              value={username}
              onChange={(e) => {
                setUsername(e.target.value);
                if (usernameError) setUsernameError(null);
              }}
              placeholder="your name"
              className="mt-1 w-full rounded-[var(--radius-input)] bg-ink-soft px-3 py-2 font-mono ring-1 ring-inset ring-aurora-700/30 focus:outline-none focus:ring-aurora-500"
            />
            {usernameError && (
              <p role="alert" className="mt-1 text-sm text-danger">
                {usernameError}
              </p>
            )}
          </div>
        )}

        <PassphraseField
          id="confirm-passphrase"
          label="Your passphrase"
          value={passphrase}
          onChange={(v) => {
            setPassphrase(v);
            if (passphraseError) setPassphraseError(null);
          }}
          autoComplete={isLateLink ? 'current-password' : 'new-password'}
        />
        {passphraseError && (
          <p role="alert" className="mt-1 text-sm text-danger">
            {passphraseError}
          </p>
        )}

        <p className="mt-3 text-xs text-paper-soft">
          Your data is encrypted with a key derived from your passphrase. The server cannot read it.
        </p>

        <button
          type="submit"
          disabled={submitting}
          className="mt-6 w-full rounded-[var(--radius-card)] bg-aurora-700 px-4 py-3 text-sm font-medium text-paper transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {submitting ? 'Working…' : isLateLink ? 'Connect this device' : 'Continue'}
        </button>
      </form>
    </main>
  );
}

// ── Error mapping ─────────────────────────────────────────────────────────────

type SubmitMapped =
  | { kind: 'username_inline'; message: string }
  | { kind: 'passphrase_inline'; message: string }
  | { kind: 'screen'; screen: Extract<Screen, { kind: 'kind_mismatch' | 'fatal' }> };

function mapSubmitError(err: unknown): SubmitMapped {
  if (err instanceof CryptoError) {
    if (err.code === 'conflict') {
      return {
        kind: 'username_inline',
        message: 'This username is taken on this server. Choose another.',
      };
    }
    if (err.code === 'opaque_protocol_error') {
      return {
        kind: 'screen',
        screen: { kind: 'fatal', message: 'Something went wrong. Please try again.' },
      };
    }
  }

  if (err instanceof HttpError) {
    // HttpError.code is already the parsed error code string from the JSON body.
    if (err.code === 'kind_mismatch') {
      return { kind: 'screen', screen: { kind: 'kind_mismatch' } };
    }
    if (err.code === 'username_taken') {
      return {
        kind: 'username_inline',
        message: 'This username is taken on this server. Choose another.',
      };
    }
    if (err.code === 'code_not_found_or_expired') {
      return {
        kind: 'screen',
        screen: {
          kind: 'fatal',
          message: 'Code not recognised. It may have expired, been used, or contain a typo.',
        },
      };
    }
    if (err.code === 'rate_limit_exceeded') {
      return {
        kind: 'screen',
        screen: { kind: 'fatal', message: 'Too many attempts. Please wait a minute.' },
      };
    }
    if (err.code === 'session_expired') {
      return {
        kind: 'screen',
        screen: { kind: 'fatal', message: 'Your session timed out. Please start again.' },
      };
    }
    if (err.status >= 500 || err.status === 0) {
      return {
        kind: 'screen',
        screen: { kind: 'fatal', message: 'Server unreachable. Check your connection.' },
      };
    }
  }

  return {
    kind: 'screen',
    screen: { kind: 'fatal', message: 'Something went wrong. Please try again.' },
  };
}
