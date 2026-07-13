// SPDX-License-Identifier: AGPL-3.0-only
import {
  CryptoError,
  getLinkedAccount,
  recoverFromScratch,
  setBiometricPromptDue,
} from '@chatsundere/crypto';
import {
  maybeProbeLinkedServer,
  probeServer,
  useAccountLinkStore,
  useConnectivityStore,
  useSessionStore,
} from '@chatsundere/ui-shared';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { activateSession } from '../../boot/activate-session.js';
import { wipeClientDataForFreshOnboarding } from '../../boot/client-data-identity.js';
import { getDb } from '../../boot/open-db.js';
import { PassphraseField } from '../../components/PassphraseField.js';
import { copy } from '../../lib/copy.js';
import { HttpError } from '../../lib/fetch.js';
import { httpServerClient } from '../../lib/server-client.js';
import { isValidServerUrl } from '../../lib/server-url.js';

type Screen =
  | { kind: 'ready' }
  | { kind: 'submitting' }
  // `action` distinguishes fatals that are genuinely retryable (server
  // unreachable, unexpected error) from the local-account-conflict fatal,
  // where re-running the same recovery attempt would just hit the same
  // conflict again — that one routes back to onboarding instead.
  | { kind: 'fatal'; message: string; action?: 'retry' | 'onboarding' };

// Verbatim copy of routes/login/recovery.tsx's mapRecoveryKeyError result for
// this code (lib/copy.ts recovery.errors.keyInvalid) — both recovery surfaces
// must show identical wording for a malformed recovery key.
const INVALID_KEY_COPY = "That recovery key doesn't match.";

// Same wording as routes/login/recovery.tsx's mapOnlineRecoveryError result for
// a 404 (lib/copy.ts recovery.errors.unknownUsername) — both recovery surfaces
// must show identical wording for an unknown username, and both keep the user
// on a live, editable form rather than a fatal dead-end.
const UNKNOWN_USERNAME_COPY = copy.recovery.errors.unknownUsername;

/** The recovery-attempt rate-limit window is 10 attempts / 15 min. */
function rateLimitMessage(retryAfterSeconds: number | undefined): string {
  if (retryAfterSeconds === undefined) return 'Too many attempts. Please wait a few minutes.';
  const minutes = Math.max(1, Math.round(retryAfterSeconds / 60));
  return `Too many attempts. Please wait about ${minutes} minutes.`;
}

/**
 * `/onboarding/recovery` — single-screen recovery-from-scratch flow.
 * User enters server URL + username + recovery key + new passphrase (twice).
 * On submit, runs `recoverFromScratch` which uses /api/v1/recovery/{start,
 * finish} to swap the server-side OPAQUE record under the new passphrase
 * and re-establishes session + local account on this device.
 */
export function OnboardingRecovery() {
  const navigate = useNavigate();

  const [baseUrl, setBaseUrl] = useState('');
  const [username, setUsername] = useState('');
  const [recoveryKey, setRecoveryKey] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [passphraseConfirm, setPassphraseConfirm] = useState('');
  const [urlError, setUrlError] = useState<string | null>(null);
  const [usernameError, setUsernameError] = useState<string | null>(null);
  const [recoveryKeyError, setRecoveryKeyError] = useState<string | null>(null);
  const [passphraseError, setPassphraseError] = useState<string | null>(null);
  // Form-level (non-field) inline error, currently used for the rate-limit
  // case: it isn't about any one input, so it renders above the submit button
  // rather than under a specific field.
  const [formError, setFormError] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>({ kind: 'ready' });

  const urlValid = isValidServerUrl(baseUrl);
  const usernameValid = username.trim().length > 0;
  const recoveryKeyValid = recoveryKey.trim().length > 0;
  const passphrasesMatch = passphrase === passphraseConfirm && passphrase.length > 0;
  const continueEnabled = urlValid && usernameValid && recoveryKeyValid && passphrasesMatch;

  async function handleContinue() {
    setUrlError(null);
    setUsernameError(null);
    setRecoveryKeyError(null);
    setPassphraseError(null);
    setFormError(null);
    if (!continueEnabled) return;
    setScreen({ kind: 'submitting' });

    const probe = await probeServer(baseUrl);
    if (probe.kind !== 'ok') {
      setScreen({ kind: 'ready' });
      setRecoveryKeyError(null);
      setUrlError(
        probe.kind === 'unreachable'
          ? copy.onboardingProbe.unreachable
          : copy.onboardingProbe.invalid,
      );
      return;
    }

    try {
      // New identity: wipe any previous identity's local data BEFORE persisting
      // the recovered crypto account, so an interrupted recovery leaves no
      // adoptable orphan rows (Larissa LOW-1).
      await wipeClientDataForFreshOnboarding(getDb());
      const result = await recoverFromScratch({
        db: getDb(),
        serverClient: httpServerClient,
        baseUrl,
        username: username.trim(),
        recoveryKeyString: recoveryKey.trim(),
        newPassphrase: passphrase,
      });
      useConnectivityStore.getState().onServerOk();
      await activateSession(result.session, result.mk);
      await setBiometricPromptDue(getDb());
      const linkedRow = await getLinkedAccount(getDb());
      if (linkedRow) useAccountLinkStore.getState().setLinked(linkedRow);
      // The device is now linked, so this probe actually populates the
      // discovery store — the sync engine's canRunCycle() would otherwise
      // no-op until a reload or connectivity event happens to fire, leaving a
      // freshly-recovered device in an empty vault.
      maybeProbeLinkedServer();
      navigate('/app', { replace: true });
    } catch (err) {
      if (err instanceof CryptoError && err.code === 'conflict') {
        setScreen({
          kind: 'fatal',
          message: 'A local account already exists on this device.',
          action: 'onboarding',
        });
        return;
      }
      if (
        err instanceof CryptoError &&
        (err.code === 'integrity_check_failed' || err.code === 'wrong_recovery_key')
      ) {
        setRecoveryKeyError('Recovery key does not unlock this account.');
        setScreen({ kind: 'ready' });
        return;
      }
      if (err instanceof CryptoError && err.code === 'not_found') {
        // Non-fatal: unknown username in a stressful recovery moment is kinder
        // fixed in place than dead-ended. Same copy + inline mechanism as
        // routes/login/recovery.tsx's mapOnlineRecoveryError 404 case.
        setUsernameError(UNKNOWN_USERNAME_COPY);
        setScreen({ kind: 'ready' });
        return;
      }
      if (err instanceof CryptoError && err.code === 'invalid_recovery_key_format') {
        // Same copy as routes/login/recovery.tsx's mapRecoveryKeyError (lib/copy.ts
        // recovery.errors.keyInvalid) — the two recovery surfaces must read identically.
        setRecoveryKeyError(INVALID_KEY_COPY);
        setScreen({ kind: 'ready' });
        return;
      }
      if (err instanceof HttpError) {
        // recoverFromScratch wraps a server 404 into CryptoError('not_found')
        // (handled above) before this catch ever sees an HttpError, so this arm
        // is unreachable via that caller today. Left as a harmless backstop in
        // case a future caller surfaces a raw 404 HttpError instead.
        if (err.status === 404 || err.code === 'not_found') {
          setUsernameError(UNKNOWN_USERNAME_COPY);
          setScreen({ kind: 'ready' });
          return;
        }
        if (err.status === 429 || err.code === 'rate_limited') {
          // Non-fatal: same honest wait-time copy, but kept on the live form
          // rather than a dead-end, consistent with the login recovery surface.
          setFormError(rateLimitMessage(err.retryAfterSeconds));
          setScreen({ kind: 'ready' });
          return;
        }
        if (err.status >= 500 || err.status === 0) {
          setScreen({ kind: 'fatal', message: 'Server unreachable. Check your connection.' });
          return;
        }
      }
      setScreen({ kind: 'fatal', message: 'Something went wrong. Please try again.' });
    }
  }

  if (screen.kind === 'fatal') {
    return (
      <main className="mx-auto min-h-dvh w-full max-w-sm px-6 py-6">
        <Link to="/onboarding" className="text-2xl text-paper-soft" aria-label="Back">
          ←
        </Link>
        <p className="mt-6 rounded-[var(--radius-card)] bg-danger/10 px-4 py-3 text-sm text-danger ring-1 ring-inset ring-danger/30">
          {screen.message}
        </p>
        {screen.action === 'onboarding' ? (
          <Link
            to="/onboarding"
            className="mt-4 inline-block text-sm text-paper-soft underline-offset-2 hover:text-paper hover:underline"
          >
            Back to onboarding
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => setScreen({ kind: 'ready' })}
            className="mt-4 inline-block text-sm text-paper-soft underline-offset-2 hover:text-paper hover:underline"
          >
            Try again
          </button>
        )}
      </main>
    );
  }

  const submitting = screen.kind === 'submitting';

  return (
    <main className="mx-auto min-h-dvh w-full max-w-sm px-6 py-6">
      <Link to="/onboarding" className="text-2xl text-paper-soft" aria-label="Back">
        ←
      </Link>
      <h1 className="mt-4 font-display text-3xl italic">Recover your account</h1>
      <p className="mt-2 text-sm text-paper-soft">
        Enter your recovery key to re-establish access and set a new passphrase.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void handleContinue();
        }}
        className="mt-6 space-y-4"
      >
        <div>
          <label
            htmlFor="recover-server"
            className="text-xs font-medium uppercase tracking-wider text-paper-soft"
          >
            Server URL
          </label>
          <input
            id="recover-server"
            type="url"
            inputMode="url"
            autoComplete="off"
            spellCheck={false}
            value={baseUrl}
            onChange={(e) => {
              setBaseUrl(e.target.value);
              if (urlError) setUrlError(null);
            }}
            placeholder="https://chatsundere.me/"
            className="mt-1 w-full rounded-[var(--radius-input)] bg-ink-soft px-3 py-2 ring-1 ring-inset ring-aurora-700/30 focus:outline-none focus:ring-aurora-500"
          />
          {urlError && (
            <p role="alert" className="mt-1 text-sm text-danger">
              {urlError}
            </p>
          )}
        </div>

        <div>
          <label
            htmlFor="recover-username"
            className="text-xs font-medium uppercase tracking-wider text-paper-soft"
          >
            Username
          </label>
          <input
            id="recover-username"
            type="text"
            autoComplete="username"
            spellCheck={false}
            value={username}
            onChange={(e) => {
              setUsername(e.target.value);
              if (usernameError) setUsernameError(null);
            }}
            className="mt-1 w-full rounded-[var(--radius-input)] bg-ink-soft px-3 py-2 font-mono ring-1 ring-inset ring-aurora-700/30 focus:outline-none focus:ring-aurora-500"
          />
          {usernameError && (
            <p role="alert" className="mt-1 text-sm text-danger">
              {usernameError}
            </p>
          )}
        </div>

        <div>
          <label
            htmlFor="recover-key"
            className="text-xs font-medium uppercase tracking-wider text-paper-soft"
          >
            Recovery key
          </label>
          <input
            id="recover-key"
            type="text"
            autoComplete="off"
            spellCheck={false}
            value={recoveryKey}
            onChange={(e) => {
              setRecoveryKey(e.target.value);
              if (recoveryKeyError) setRecoveryKeyError(null);
            }}
            placeholder="XXXX-XXXX-XXXX-XXXX"
            className="mt-1 w-full rounded-[var(--radius-input)] bg-ink-soft px-3 py-2 font-mono ring-1 ring-inset ring-aurora-700/30 focus:outline-none focus:ring-aurora-500"
          />
          {recoveryKeyError && (
            <p role="alert" className="mt-1 text-sm text-danger">
              {recoveryKeyError}
            </p>
          )}
        </div>

        <PassphraseField
          id="recover-passphrase"
          label="New passphrase"
          value={passphrase}
          onChange={(v) => {
            setPassphrase(v);
            if (passphraseError) setPassphraseError(null);
          }}
          autoComplete="new-password"
        />

        <PassphraseField
          id="recover-passphrase-confirm"
          label="Confirm new passphrase"
          value={passphraseConfirm}
          onChange={(v) => {
            setPassphraseConfirm(v);
            if (passphraseError) setPassphraseError(null);
          }}
          autoComplete="new-password"
        />
        {!passphrasesMatch && passphraseConfirm.length > 0 && (
          <p role="alert" className="text-sm text-danger">
            Passphrases do not match.
          </p>
        )}
        {formError && (
          <p role="alert" className="text-sm text-danger">
            {formError}
          </p>
        )}

        <button
          type="submit"
          disabled={!continueEnabled || submitting}
          className="w-full rounded-[var(--radius-card)] bg-aurora-700 px-4 py-3 text-sm font-medium text-paper transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {submitting ? 'Working…' : 'Recover account'}
        </button>
      </form>
    </main>
  );
}
