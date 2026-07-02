// SPDX-License-Identifier: AGPL-3.0-only
import {
  CryptoError,
  PRF_INPUT_SALT,
  type PasskeyCredentialRow,
  getLocalAccount,
  listLocalBiometric,
  loginLocalWithPassphrase,
  loginOnlineLinked,
  loginWithLocalBiometric,
} from '@chatsundere/crypto';
import { useAccountLinkStore, useConnectivityStore, useSessionStore } from '@chatsundere/ui-shared';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getDb } from '../../boot/open-db.js';
import { PassphraseField } from '../../components/PassphraseField.js';
import { useDisplayName } from '../../data/settings.js';
import { copy } from '../../lib/copy.js';
import { httpServerClient } from '../../lib/server-client.js';
import { isWebAuthnAvailable } from '../../lib/webauthn-availability.js';

/**
 * Login screen.
 *
 * Spec §5.4: shows username, passphrase field, and (when at least one passkey
 * exists and the device is WebAuthn-capable) a primary biometric button with
 * the passphrase field collapsed below. "Forgot passphrase?" is always
 * visible. Gate widened to any WebAuthn-capable device per ADR 0022.
 */
export function Login() {
  const navigate = useNavigate();

  const [username, setUsername] = useState<string | null>(null);
  // Whether a linked account exists — drives which login flow to call. Sourced
  // from the account-link store (WS-0 boot populates it before this screen).
  const hasLinked = useAccountLinkStore((s) => s.linkStatus === 'linked');
  // 'unknown' means the boot-time read has not resolved yet — treat it as
  // loading, exactly as a not-yet-loaded username is treated below.
  const linkStatusKnown = useAccountLinkStore((s) => s.linkStatus !== 'unknown');
  const [passkeys, setPasskeys] = useState<PasskeyCredentialRow[]>([]);
  const [webAuthnAvailable] = useState(() => isWebAuthnAvailable());

  // Resolved name to show in the heading: displayName if set, else the
  // locally-loaded username (the pre-session screen has no session yet).
  const displayName = useDisplayName(username);

  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const passphraseRef = useRef<HTMLInputElement>(null);

  // Once the cold-start intro is over, drop focus into the passphrase field so
  // the keyboard opens and the user can type straight away — unlocking is what
  // they came here to do. The animated path fires `splash-flip-done` (~2s); the
  // reduced-motion / skip paths fire `splash-dismissed`; whichever lands first
  // wins. When no splash plays this load (warm reload), focus immediately.
  // (Mobile note: a programmatic focus outside a user gesture may place the
  // caret without raising the on-screen keyboard on some browsers, e.g. iOS.)
  useEffect(() => {
    const focusPassphrase = (): void => passphraseRef.current?.focus();
    const splashActive = sessionStorage.getItem('splashShown') === null;
    if (!splashActive) {
      focusPassphrase();
      return;
    }
    let done = false;
    const once = (): void => {
      if (done) return;
      done = true;
      focusPassphrase();
    };
    window.addEventListener('chatsundere:splash-flip-done', once);
    window.addEventListener('chatsundere:splash-dismissed', once);
    return () => {
      window.removeEventListener('chatsundere:splash-flip-done', once);
      window.removeEventListener('chatsundere:splash-dismissed', once);
    };
  }, []);

  // Load account info and biometric availability once on mount.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const db = getDb();
      const [local, creds] = await Promise.all([getLocalAccount(db), listLocalBiometric(db)]);

      if (cancelled) return;

      if (!local) {
        // No account on this device — redirect to onboarding.
        navigate('/onboarding', { replace: true });
        return;
      }

      setUsername(local.username);
      setPasskeys(creds);
    })();

    return () => {
      cancelled = true;
    };
  }, [navigate]);

  // ADR 0022: under UV='preferred' we accept cross-platform passkeys too,
  // not just UVPAA platform authenticators. The gate is "any WebAuthn-capable
  // device with at least one registered passkey".
  const passkeyUnlockAvailable = passkeys.length > 0 && webAuthnAvailable;

  async function handlePassphraseUnlock() {
    setError(null);
    setBusy(true);
    try {
      const db = getDb();
      if (hasLinked) {
        // Double-auth: local OPAQUE + server OPAQUE.
        const { session, mk, serverOutcome } = await loginOnlineLinked({
          db,
          serverClient: httpServerClient,
          passphrase,
        });
        // setSession before connectivity transitions per Task 4 reviewer note.
        // mk passed as explicit second arg per Task 7 store refactor.
        useSessionStore.getState().setSession(session, mk);
        switch (serverOutcome.kind) {
          case 'ok':
            useConnectivityStore.getState().onServerOk();
            break;
          case 'unreachable':
            useConnectivityStore.getState().onServerUnreachable();
            break;
          case 'auth_failed':
            useConnectivityStore.getState().onServerAuthFailed();
            break;
          case 'skipped':
            // No connectivity transition — server was never contacted.
            break;
        }
      } else {
        // Local-only account.
        const { session, mk } = await loginLocalWithPassphrase({ db, passphrase });
        useSessionStore.getState().setSession(session, mk);
      }
      navigate('/app', { replace: true });
    } catch (e) {
      // Spec §5.6: no distinction between wrong passphrase and missing account
      // to prevent information leakage.
      if (e instanceof CryptoError) {
        if (e.code === 'wrong_passphrase' || e.code === 'not_found') {
          setError(copy.login.errors.wrongPassphrase);
        } else {
          setError(copy.login.errors.unknown);
        }
      } else {
        setError(copy.login.errors.unknown);
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleBiometricUnlock() {
    // Guarded: passkeyUnlockAvailable being true implies passkeys.length > 0,
    // but noUncheckedIndexedAccess requires an explicit check before indexing.
    const firstPasskey = passkeys[0];
    if (!firstPasskey) return;

    setError(null);
    setBusy(true);
    try {
      const challenge = crypto.getRandomValues(new Uint8Array(32)) as Uint8Array<ArrayBuffer>;
      const prfSalt = await PRF_INPUT_SALT;
      const assertion = (await navigator.credentials.get({
        publicKey: {
          challenge,
          allowCredentials: [
            // .slice() produces Uint8Array<ArrayBuffer> from Uint8Array<ArrayBufferLike>,
            // satisfying the BufferSource constraint of the WebAuthn API.
            { type: 'public-key', id: firstPasskey.credential_id.slice() },
          ],
          // ADR 0022: 'preferred' lets cross-platform passkeys (Bitwarden,
          // Yubikey-without-PIN) unlock without being refused. PRF (ADR 0005)
          // still gates acceptance below.
          userVerification: 'preferred',
          // PRF eval.first must use the same salt the credential was registered
          // with — otherwise the authenticator produces a different PRF output
          // and the wrapped MK cannot be unwrapped. PRF_INPUT_SALT is the
          // single app-wide value used by both registration and unlock.
          extensions: { prf: { eval: { first: prfSalt.slice() } } },
        },
      })) as PublicKeyCredential | null;

      if (!assertion) {
        setError(copy.login.errors.passkeyUnlockFailed);
        return;
      }

      const response = assertion.response as AuthenticatorAssertionResponse;
      // The standard AuthenticationExtensionsClientOutputs type does not
      // expose the PRF extension shape; this cast is the standard workaround.
      const extResults = assertion.getClientExtensionResults() as {
        prf?: { results?: { first?: ArrayBuffer } };
      };
      const prfFirst = extResults.prf?.results?.first;
      if (!prfFirst) {
        setError(copy.login.errors.passkeyUnlockFailed);
        return;
      }

      const session = await loginWithLocalBiometric({
        db: getDb(),
        credentialId: new Uint8Array(assertion.rawId),
        challenge,
        clientDataJson: new TextDecoder().decode(response.clientDataJSON),
        authenticatorData: new Uint8Array(response.authenticatorData),
        signature: new Uint8Array(response.signature),
        prfOutput: new Uint8Array(prfFirst),
        origin: window.location.origin,
      });

      useSessionStore.getState().setSession(session);
      navigate('/app', { replace: true });
    } catch (_e) {
      // All biometric errors map to the same user-facing message regardless of
      // the underlying cause — no detail that could aid an attacker.
      setError(copy.login.errors.passkeyUnlockFailed);
    } finally {
      setBusy(false);
    }
  }

  // Show nothing while the username or the link status is still loading.
  if (username === null || !linkStatusKnown) {
    return <p className="mt-12 text-center text-paper-soft">Loading…</p>;
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm space-y-8">
        {/* Heading */}
        <h1 className="font-display text-3xl italic tracking-tight text-aurora-200 lg:text-4xl">
          {copy.login.headingPrefix} <span className="text-paper">{displayName}</span>
        </h1>

        <div className="space-y-4">
          {/* Primary biometric button — shown when passkeys exist and WebAuthn is available */}
          {passkeyUnlockAvailable && (
            <button
              type="button"
              onClick={() => void handleBiometricUnlock()}
              disabled={busy}
              className="w-full rounded-[var(--radius-card)] bg-aurora-600 px-4 py-3 font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy ? copy.login.unlockingCta : copy.login.passkeyUnlockCta}
            </button>
          )}

          {/* Passphrase field — always present; collapsed label when biometric is primary */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handlePassphraseUnlock();
            }}
            className="space-y-4"
          >
            <PassphraseField
              id="login-passphrase"
              label={copy.login.passphraseLabel}
              value={passphrase}
              onChange={setPassphrase}
              autoComplete="current-password"
              inputRef={passphraseRef}
            />

            {error && (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy || passphrase.length === 0}
              className="w-full rounded-[var(--radius-card)] bg-aurora-700 px-4 py-3 font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {busy ? copy.login.unlockingCta : copy.login.unlockCta}
            </button>
          </form>

          {/* Forgot passphrase — always visible */}
          <div className="text-center">
            <button
              type="button"
              onClick={() => navigate('/login/recovery')}
              className="text-sm text-paper-soft underline-offset-2 hover:text-paper hover:underline"
            >
              {copy.login.forgotLink}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
