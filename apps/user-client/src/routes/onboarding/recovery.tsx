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

type Screen = { kind: 'ready' } | { kind: 'submitting' } | { kind: 'fatal'; message: string };

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
  const [recoveryKeyError, setRecoveryKeyError] = useState<string | null>(null);
  const [passphraseError, setPassphraseError] = useState<string | null>(null);
  const [screen, setScreen] = useState<Screen>({ kind: 'ready' });

  const urlValid = isValidServerUrl(baseUrl);
  const usernameValid = username.trim().length > 0;
  const recoveryKeyValid = recoveryKey.trim().length > 0;
  const passphrasesMatch = passphrase === passphraseConfirm && passphrase.length > 0;
  const continueEnabled = urlValid && usernameValid && recoveryKeyValid && passphrasesMatch;

  async function handleContinue() {
    setUrlError(null);
    setRecoveryKeyError(null);
    setPassphraseError(null);
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
        setScreen({ kind: 'fatal', message: 'A local account already exists on this device.' });
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
      if (err instanceof HttpError) {
        if (err.status === 404 || err.code === 'not_found') {
          setScreen({ kind: 'fatal', message: 'No account with that username on this server.' });
          return;
        }
        if (err.status === 429 || err.code === 'rate_limit_exceeded') {
          setScreen({ kind: 'fatal', message: 'Too many attempts. Please wait a minute.' });
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
        <button
          type="button"
          onClick={() => setScreen({ kind: 'ready' })}
          className="mt-4 inline-block text-sm text-paper-soft underline-offset-2 hover:text-paper hover:underline"
        >
          Try again
        </button>
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
            onChange={(e) => setUsername(e.target.value)}
            className="mt-1 w-full rounded-[var(--radius-input)] bg-ink-soft px-3 py-2 font-mono ring-1 ring-inset ring-aurora-700/30 focus:outline-none focus:ring-aurora-500"
          />
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
