// SPDX-License-Identifier: AGPL-3.0-only
import {
  CryptoError,
  type MasterKey,
  type MasterKeySession,
  changePassphraseLocalOnly,
  getLinkedAccount,
  getLocalAccount,
  loginLocalWithRecoveryKey,
  recoveryOnline,
  regenerateRecoveryKey,
} from '@chatsundere/crypto';
import { useConnectivityStore, useSessionStore } from '@chatsundere/ui-shared';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import * as v from 'valibot';
import { activateSession } from '../../boot/activate-session.js';
import { getDb } from '../../boot/open-db.js';
import { PassphraseField } from '../../components/PassphraseField.js';
import { RecoveryKeyInput } from '../../components/RecoveryKeyInput.js';
import { RecoveryKeyReveal } from '../../components/RecoveryKeyReveal.js';
import { env } from '../../env.js';
import { copy } from '../../lib/copy.js';
import { httpServerClient } from '../../lib/server-client.js';
import { PassphrasePair, RecoveryKeyLike } from '../../lib/validators.js';

type RecoveryScope = 'local' | 'full';

type Step =
  | { kind: 'step1' }
  | { kind: 'step2-local'; session: MasterKeySession; mk: MasterKey }
  | { kind: 'step2-deferred' }
  | { kind: 'step3'; newKeyString: string };

/**
 * Recovery flow. Two branches:
 *
 * - Local-only account: recovery key → new passphrase → (optionally) new recovery key.
 * - Linked account: choose scope (local vs full server) → same three steps;
 *   full scope calls `recoveryOnline`, which returns the fresh linked+online
 *   session directly — no separate local unlock round is needed.
 *
 * Spec §5.4(c) and §5.8.
 */
export function Recovery() {
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>({ kind: 'step1' });

  // Step 1 fields.
  const [recoveryKey, setRecoveryKey] = useState('');
  const [scope, setScope] = useState<RecoveryScope>('local');
  const [isLinked, setIsLinked] = useState<boolean | null>(null);

  // Step 2 fields.
  const [newPassphrase, setNewPassphrase] = useState('');
  const [confirmPassphrase, setConfirmPassphrase] = useState('');
  const [regenerate, setRegenerate] = useState(false);

  // Step 3 field.
  const [confirmStored, setConfirmStored] = useState(false);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const c = copy.recovery;

  // Detect linked account once on mount. useEffect ensures StrictMode's double
  // invocation in dev does not double-fire the IDB read in production.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const db = getDb();
      const linked = await getLinkedAccount(db);
      if (!cancelled) setIsLinked(linked !== null);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ── Step 1: recovery key entry ────────────────────────────────────────────

  async function handleStep1Submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Validate key format before attempting unlock.
    const keyResult = v.safeParse(RecoveryKeyLike, recoveryKey);
    if (!keyResult.success) {
      setError(c.errors.keyInvalid);
      return;
    }

    setBusy(true);
    try {
      const db = getDb();

      if (scope === 'full' && isLinked) {
        // For full recovery we collect the passphrase first (step 2-deferred)
        // and call recoveryOnline at submit time, which returns the fresh
        // linked+online session directly. No session/mk is available at this
        // point — the deferred variant carries no payload.
        setStep({ kind: 'step2-deferred' });
        return;
      }

      // Local-only path (always) or linked with local scope.
      const { session, mk } = await loginLocalWithRecoveryKey({
        db,
        recoveryKeyString: recoveryKey,
      });

      setStep({ kind: 'step2-local', session, mk });
    } catch (e) {
      setError(mapRecoveryKeyError(e));
    } finally {
      setBusy(false);
    }
  }

  // ── Step 2: new passphrase ────────────────────────────────────────────────

  async function handleStep2Submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (step.kind !== 'step2-local' && step.kind !== 'step2-deferred') return;

    // Validate passphrase pair.
    const pairResult = v.safeParse(PassphrasePair, {
      passphrase: newPassphrase,
      confirmation: confirmPassphrase,
    });
    if (!pairResult.success) {
      const issue = pairResult.issues[0];
      setError(issue?.message ?? c.errors.unknown);
      return;
    }

    setBusy(true);
    try {
      const db = getDb();
      let session: MasterKeySession;
      let mk: MasterKey;

      if (step.kind === 'step2-deferred' && isLinked) {
        // Full server recovery path — run recoveryOnline now that we have the passphrase.
        const localRow = await getLocalAccount(db);
        if (!localRow) {
          setError(c.errors.unknown);
          return;
        }
        if (!env.VITE_AUTH_URL) {
          // Server-coupled recovery requires the auth-service URL. In Block 1
          // local-only deployments the URL is not configured; the onboarding
          // gating prevents reaching this path, but guard anyway.
          setError(c.errors.unknown);
          return;
        }
        try {
          // recoveryOnline returns the fresh linked+online session directly
          // (carrying the server-issued access token) — adopt it rather than
          // re-deriving a second, offline local session, which would leave
          // the user unauthenticated for sync despite a successful
          // server-assisted recovery.
          const result = await recoveryOnline({
            db,
            serverClient: httpServerClient,
            baseUrl: env.VITE_AUTH_URL,
            username: localRow.username,
            recoveryKeyString: recoveryKey,
            newPassphrase,
          });
          session = result.session;
          mk = result.mk;
        } catch (err) {
          setError(mapOnlineRecoveryError(err));
          return;
        }

        // Mark the server connection as established.
        await activateSession(session, mk);
        useConnectivityStore.getState().onServerOk();
      } else if (step.kind === 'step2-local') {
        // Local-only path: session and mk already present from step 1.
        session = step.session;
        mk = step.mk;
        await activateSession(session, mk);
      } else {
        // step2-deferred without isLinked is unreachable under the spec
        // (deferred only ever set in the full-recovery branch which requires
        // isLinked). Surface a fail-safe error rather than continuing.
        setError(c.errors.unknown);
        return;
      }

      // Always re-wrap the local passphrase slot under the new passphrase.
      await changePassphraseLocalOnly({ db, session, mk, newPassphrase });

      if (regenerate && isLinked === false) {
        // Generate a fresh recovery key and move to the reveal step. Linked
        // accounts never reach this branch (the checkbox is disabled): the new
        // key must be registered with the server under an authenticated
        // session, which My Account → Recovery Key owns.
        const { recoveryKeyString } = await regenerateRecoveryKey({ db, mk });
        setStep({ kind: 'step3', newKeyString: recoveryKeyString });
      } else {
        navigate('/app', { replace: true });
      }
    } catch {
      // changePassphraseLocalOnly or regenerateRecoveryKey failure path.
      // Both CryptoError and unexpected runtime errors resolve to the same
      // friendly message; there is no diagnostic distinction to draw here.
      setError(c.errors.unknown);
    } finally {
      setBusy(false);
    }
  }

  // ── Step 3: new recovery key reveal ───────────────────────────────────────

  function handleStep3Finish() {
    navigate('/app', { replace: true });
  }

  // ── Error mappers ─────────────────────────────────────────────────────────

  function mapRecoveryKeyError(err: unknown): string {
    if (err instanceof CryptoError) {
      switch (err.code) {
        case 'wrong_passphrase':
        case 'wrong_recovery_key':
        case 'invalid_recovery_key_format':
        case 'integrity_check_failed':
          return c.errors.keyInvalid;
        default:
          return c.errors.unknown;
      }
    }
    return c.errors.unknown;
  }

  function mapOnlineRecoveryError(err: unknown): string {
    if (err instanceof CryptoError) {
      switch (err.code) {
        case 'wrong_recovery_key':
        case 'invalid_recovery_key_format':
          return c.errors.keyInvalid;
        default:
          return c.errors.serverUnreachable;
      }
    }
    // Non-CryptoError (network failure, HTTP error) → server unreachable message.
    return c.errors.serverUnreachable;
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (step.kind === 'step3') {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm space-y-8">
          <div className="space-y-1">
            <h1 className="font-display text-3xl italic tracking-tight text-aurora-200 lg:text-4xl">
              {c.newKeyTitle}
            </h1>
            <p className="text-sm text-paper-soft">{c.newKeyBody}</p>
          </div>

          <RecoveryKeyReveal value={step.newKeyString} />

          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={confirmStored}
              onChange={(e) => setConfirmStored(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 accent-aurora-500"
            />
            <span className="text-sm text-paper-soft">{c.newKeyConfirmLabel}</span>
          </label>

          <button
            type="button"
            disabled={!confirmStored}
            onClick={handleStep3Finish}
            className="w-full rounded-[var(--radius-card)] bg-aurora-500 px-6 py-3 font-mono text-sm uppercase tracking-wider text-paper hover:bg-aurora-200 hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
            aria-disabled={!confirmStored}
          >
            {c.newKeyFinishCta}
          </button>
        </div>
      </main>
    );
  }

  if (step.kind === 'step2-local' || step.kind === 'step2-deferred') {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm space-y-8">
          <div className="space-y-1">
            <h1 className="font-display text-3xl italic tracking-tight text-aurora-200 lg:text-4xl">
              {c.step2Title}
            </h1>
            <p className="text-sm text-paper-soft">{c.step2Body}</p>
          </div>

          <form
            onSubmit={(e) => {
              void handleStep2Submit(e);
            }}
            className="space-y-4"
          >
            <PassphraseField
              id="recovery-new-passphrase"
              label={c.newPassphraseLabel}
              value={newPassphrase}
              onChange={setNewPassphrase}
              meter
              autoComplete="new-password"
            />
            <PassphraseField
              id="recovery-confirm-passphrase"
              label={c.confirmPassphraseLabel}
              value={confirmPassphrase}
              onChange={setConfirmPassphrase}
              autoComplete="new-password"
            />

            {/* Optional: generate a new recovery key. Disabled for linked
                accounts: the new key must be registered with the server too,
                which needs an authenticated session — offering it here would
                silently desynchronise deviceless recovery. Disabled over
                hidden, with the constructive path named. */}
            <div className="space-y-1">
              <label
                className={
                  isLinked
                    ? 'flex cursor-not-allowed items-start gap-3 opacity-60'
                    : 'flex cursor-pointer items-start gap-3'
                }
              >
                <input
                  type="checkbox"
                  checked={regenerate && isLinked === false}
                  // `null` (link detection still resolving) fails SAFE to
                  // disabled: a tick during that window on a linked account
                  // would rotate locally-only — the exact desync this guards.
                  disabled={isLinked !== false}
                  onChange={(e) => setRegenerate(e.target.checked)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-aurora-500"
                />
                <span className="text-sm text-paper-soft">{c.regenerateLabel}</span>
              </label>
              {isLinked && <p className="pl-7 text-xs text-paper-soft">{c.regenerateLinkedHint}</p>}
              {isLinked === false && regenerate && (
                <p className="pl-7 text-xs text-paper-soft">{c.regenerateHint}</p>
              )}
            </div>

            {error && (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy || newPassphrase.length === 0 || confirmPassphrase.length === 0}
              className="w-full rounded-[var(--radius-card)] bg-aurora-700 px-4 py-3 font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy ? 'Working…' : c.finishCta}
            </button>
          </form>
        </div>
      </main>
    );
  }

  // step.kind === 'step1'
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm space-y-8">
        <div className="space-y-1">
          <h1 className="font-display text-3xl italic tracking-tight text-aurora-200 lg:text-4xl">
            {c.step1Title}
          </h1>
          <p className="text-sm text-paper-soft">{c.step1Body}</p>
        </div>

        <form
          onSubmit={(e) => {
            void handleStep1Submit(e);
          }}
          className="space-y-6"
        >
          <RecoveryKeyInput value={recoveryKey} onChange={setRecoveryKey} disabled={busy} />

          {/* Scope selector — linked accounts only */}
          {isLinked && (
            <fieldset className="space-y-3">
              <legend className="text-sm font-medium text-paper">{c.scopeTitle}</legend>
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="radio"
                  name="recovery-scope"
                  value="local"
                  checked={scope === 'local'}
                  onChange={() => setScope('local')}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-aurora-500"
                />
                <span className="space-y-0.5">
                  <span className="block text-sm font-medium text-paper">{c.scopeLocalOption}</span>
                  <span className="block text-xs text-paper-soft">{c.scopeLocalBody}</span>
                </span>
              </label>
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="radio"
                  name="recovery-scope"
                  value="full"
                  checked={scope === 'full'}
                  onChange={() => setScope('full')}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-aurora-500"
                />
                <span className="space-y-0.5">
                  <span className="block text-sm font-medium text-paper">{c.scopeFullOption}</span>
                  <span className="block text-xs text-paper-soft">{c.scopeFullBody}</span>
                </span>
              </label>
            </fieldset>
          )}

          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={busy || recoveryKey.length === 0}
            className="w-full rounded-[var(--radius-card)] bg-aurora-700 px-4 py-3 font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {busy ? 'Checking…' : c.continueCta}
          </button>
        </form>

        <div className="text-center">
          <button
            type="button"
            onClick={() => navigate('/login')}
            className="text-sm text-paper-soft underline-offset-2 hover:text-paper hover:underline"
          >
            Back to sign-in
          </button>
        </div>
      </div>
    </main>
  );
}
