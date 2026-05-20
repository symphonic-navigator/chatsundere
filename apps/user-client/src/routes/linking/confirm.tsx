// SPDX-License-Identifier: AGPL-3.0-only

import {
  CryptoError,
  PRF_INPUT_SALT,
  addPasskeyPostLink,
  changeUsername,
  linkToServer,
  listPasskeyCredentials,
} from '@chatsundere/crypto';
import type { RegistrationResponseJSON } from '@chatsundere/shared-types';
import { useConnectivityStore, useSessionStore } from '@chatsundere/ui-shared';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { getDb } from '../../boot/open-db.js';
import { PassphraseField } from '../../components/PassphraseField.js';
import { copy } from '../../lib/copy.js';
import { HttpError } from '../../lib/fetch.js';
import type { InvitationQrPayload } from '../../lib/qr.js';
import { httpServerClient } from '../../lib/server-client.js';
import { PrfRequiredError } from '../../lib/webauthn.js';
import { useLinkingStore } from '../../state/linking.store.js';

// ── Screen state ─────────────────────────────────────────────────────────────

type ConfirmScreen =
  | { kind: 'confirm' }
  | { kind: 'working' }
  | { kind: 'success'; hasUnsyncedBiometric: boolean }
  | { kind: 'biometric_setup'; busy: boolean; error: string | null }
  | { kind: 'username_taken' }
  | { kind: 'error'; message: string };

// ── Gate component ────────────────────────────────────────────────────────────

/**
 * `/linking/confirm` — Final linking confirmation and OPAQUE registration.
 *
 * Guards against missing payload by redirecting to `/linking/scan` when the
 * linking store is empty, then delegates to `LinkingConfirmInner` with the
 * non-null payload.
 */
export function LinkingConfirm() {
  const navigate = useNavigate();
  const payload = useLinkingStore((s) => s.payload);

  if (!payload) {
    // Payload is absent (e.g. direct navigation). Redirect to scan.
    // Use a render-time navigate via useEffect is cleaner but TypeScript needs
    // a synchronous guard here to narrow the type for the inner component.
    navigate('/linking/scan', { replace: true });
    return null;
  }

  return <LinkingConfirmInner payload={payload} />;
}

// ── Inner component (payload guaranteed non-null) ─────────────────────────────

function LinkingConfirmInner({ payload }: { payload: InvitationQrPayload }) {
  const navigate = useNavigate();
  const clearPayload = useLinkingStore((s) => s.clear);

  const [screen, setScreen] = useState<ConfirmScreen>({ kind: 'confirm' });
  const [passphrase, setPassphrase] = useState('');

  // Rename-and-retry state.
  const [renameValue, setRenameValue] = useState('');
  const [renameBusy, setRenameBusy] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

  const session = useSessionStore((s) => s.session);
  const username = session?.username ?? '';

  const c = copy.linking.confirm;
  const ce = c.errors;

  // ── Helpers ───────────────────────────────────────────────────────────────

  function mapLinkError(err: unknown): string {
    if (err instanceof CryptoError) {
      switch (err.code) {
        case 'conflict':
          // Conflict handled separately — caller checks before calling this.
          return ce.unknown;
        default:
          return ce.unknown;
      }
    }
    if (err instanceof HttpError) {
      if (err.status === 0 || err.status >= 500) return ce.serverUnreachable;
      if (err.status === 401 || err.status === 403) return ce.tokenInvalid;
      if (err.status === 410) return ce.tokenExpired;
    }
    // Network-level failures surface as plain Errors without `.status`.
    return ce.serverUnreachable;
  }

  // ── Link action ───────────────────────────────────────────────────────────

  async function doLink() {
    const currentSession = useSessionStore.getState().session;
    if (!currentSession?.mk) {
      setScreen({ kind: 'error', message: ce.unknown });
      return;
    }

    setScreen({ kind: 'working' });

    try {
      await linkToServer({
        db: getDb(),
        serverClient: httpServerClient,
        invitationToken: payload.token,
        baseUrl: payload.base_url,
        issuerLabel: payload.issuer_label,
        passphrase,
        mk: currentSession.mk,
      });

      useConnectivityStore.getState().onServerOk();
      useSessionStore.getState().setSession({ ...currentSession, mode: 'linked' });

      const creds = await listPasskeyCredentials(getDb());
      const hasUnsynced = creds.some((c) => !c.is_synced_with_server);

      clearPayload();
      setScreen({ kind: 'success', hasUnsyncedBiometric: hasUnsynced });
    } catch (err) {
      if (err instanceof CryptoError && err.code === 'conflict') {
        setScreen({ kind: 'username_taken' });
        return;
      }
      setScreen({ kind: 'error', message: mapLinkError(err) });
    }
  }

  // ── Rename-and-retry ──────────────────────────────────────────────────────

  async function handleRenameRetry() {
    if (!renameValue.trim()) return;
    setRenameBusy(true);
    setRenameError(null);

    try {
      await changeUsername({ db: getDb(), newUsername: renameValue.trim() });
      setRenameBusy(false);
      await doLink();
    } catch (err) {
      if (err instanceof CryptoError && err.code === 'invalid_input') {
        setRenameError(copy.errors.usernameInvalid);
      } else {
        setRenameError(ce.unknown);
      }
      setRenameBusy(false);
      setScreen({ kind: 'username_taken' });
    }
  }

  // ── Biometric sync ────────────────────────────────────────────────────────

  async function handleBiometricSync() {
    const currentSession = useSessionStore.getState().session;
    if (!currentSession?.accessToken || !currentSession.mk) {
      setScreen({ kind: 'biometric_setup', busy: false, error: ce.unknown });
      return;
    }

    setScreen({ kind: 'biometric_setup', busy: true, error: null });

    try {
      // Start the server-side passkey link session (ADR 0021: OPAQUE must precede passkey).
      const startResp = await httpServerClient.linkPasskeyStart(
        {},
        payload.base_url,
        currentSession.accessToken,
      );

      const prfSalt = await PRF_INPUT_SALT;

      // Decode the server challenge from base64url.
      const challengeBytes = Uint8Array.from(
        atob(startResp.options.challenge.replace(/-/g, '+').replace(/_/g, '/')),
        (c) => c.charCodeAt(0),
      );

      // Drive a fresh credential creation ceremony that yields a server-uploadable JSON.
      const credential = (await navigator.credentials.create({
        publicKey: {
          challenge: challengeBytes,
          rp: { name: 'Chatsundere', id: new URL(payload.base_url).hostname },
          user: {
            id: new TextEncoder().encode(currentSession.userId),
            name: currentSession.username,
            displayName: currentSession.username,
          },
          pubKeyCredParams: [
            { type: 'public-key', alg: -7 },
            { type: 'public-key', alg: -257 },
          ],
          authenticatorSelection: {
            userVerification: 'required',
            residentKey: 'preferred',
          },
          extensions: { prf: { eval: { first: prfSalt.slice() } } },
        },
      })) as PublicKeyCredential | null;

      if (!credential) throw new PrfRequiredError();

      const response = credential.response as AuthenticatorAttestationResponse;
      const extResults = credential.getClientExtensionResults() as {
        prf?: { results?: { first?: ArrayBuffer } };
      };
      const prfFirst = extResults.prf?.results?.first;
      if (!prfFirst) throw new PrfRequiredError();

      const publicKeyBytes = response.getPublicKey();
      if (!publicKeyBytes) throw new Error('authenticator did not return a public key');

      const credentialId = new Uint8Array(credential.rawId);
      const credJson = buildRegistrationResponseJson(credential, response);

      await addPasskeyPostLink({
        db: getDb(),
        serverClient: httpServerClient,
        accessToken: currentSession.accessToken,
        mk: currentSession.mk,
        credentialJson: credJson,
        credentialId,
        publicKey: new Uint8Array(publicKeyBytes),
        aaguid: null,
        prfOutput: new Uint8Array(prfFirst),
        label: 'Biometric',
        sessionId: startResp.session_id,
      });

      navigate('/app', { replace: true });
    } catch (err) {
      if (err instanceof PrfRequiredError) {
        setScreen({
          kind: 'biometric_setup',
          busy: false,
          error:
            'This authenticator does not support the required PRF extension. Try a different authenticator.',
        });
      } else {
        setScreen({ kind: 'biometric_setup', busy: false, error: ce.unknown });
      }
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  if (screen.kind === 'confirm' || screen.kind === 'working') {
    const working = screen.kind === 'working';
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm space-y-6">
          <h1 className="font-display text-3xl italic tracking-tight text-aurora-200 lg:text-4xl">
            {c.title}
          </h1>
          <p className="text-sm leading-relaxed text-paper-soft">{c.body}</p>

          {/* Invitation details */}
          <dl className="space-y-3 rounded-[var(--radius-card)] bg-ink-soft px-4 py-4 ring-1 ring-inset ring-aurora-700/20">
            {payload.issuer_label && (
              <div className="flex justify-between gap-4">
                <dt className="text-xs font-medium uppercase tracking-wider text-paper-soft">
                  {c.issuerLabel}
                </dt>
                <dd className="truncate text-sm text-paper">{payload.issuer_label}</dd>
              </div>
            )}
            <div className="flex justify-between gap-4">
              <dt className="text-xs font-medium uppercase tracking-wider text-paper-soft">
                {c.serverLabel}
              </dt>
              <dd className="truncate font-mono text-sm text-paper">{payload.base_url}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-xs font-medium uppercase tracking-wider text-paper-soft">
                {c.roleLabel}
              </dt>
              <dd className="font-mono text-sm text-paper">{payload.role}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-xs font-medium uppercase tracking-wider text-paper-soft">
                {c.usernameLabel}
              </dt>
              <dd className="font-mono text-sm text-paper">{username}</dd>
            </div>
          </dl>

          {/* Passphrase required for OPAQUE registration on the server */}
          <PassphraseField
            id="link-passphrase"
            label="Your passphrase"
            value={passphrase}
            onChange={setPassphrase}
            autoComplete="current-password"
          />

          <div className="flex flex-col gap-3">
            <button
              type="button"
              disabled={working || passphrase.length === 0}
              onClick={() => void doLink()}
              className="w-full rounded-[var(--radius-card)] bg-aurora-700 px-4 py-3 text-sm font-medium text-paper transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {working ? c.workingCta : c.confirmCta}
            </button>
            <Link
              to="/settings/server-linking"
              className="text-center text-sm text-paper-soft underline-offset-2 hover:text-paper hover:underline"
            >
              {c.cancelCta}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (screen.kind === 'username_taken') {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm space-y-6">
          <div className="rounded-[var(--radius-card)] bg-danger/10 px-4 py-4 ring-1 ring-inset ring-danger/30">
            <p className="font-medium text-danger">{ce.usernameTaken}</p>
          </div>

          <div className="space-y-3">
            <p className="text-sm text-paper-soft">Choose a different username and try again.</p>
            <input
              type="text"
              value={renameValue}
              onChange={(e) => {
                setRenameValue(e.target.value);
                setRenameError(null);
              }}
              placeholder="New username"
              autoComplete="off"
              disabled={renameBusy}
              className="w-full rounded-[var(--radius-input)] bg-ink-soft px-4 py-3 font-mono text-sm text-paper placeholder-paper-soft/40 ring-1 ring-inset ring-aurora-700/30 focus:outline-none focus:ring-aurora-500 disabled:opacity-50"
            />
            {renameError && <p className="text-sm text-danger">{renameError}</p>}
          </div>

          <div className="flex flex-col gap-3">
            <button
              type="button"
              disabled={renameBusy || !renameValue.trim()}
              onClick={() => void handleRenameRetry()}
              className="w-full rounded-[var(--radius-card)] bg-aurora-700 px-4 py-3 text-sm font-medium text-paper transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {renameBusy ? c.workingCta : ce.usernameTakenRenameCta}
            </button>
            <button
              type="button"
              disabled={renameBusy}
              onClick={() => {
                clearPayload();
                navigate('/settings/server-linking', { replace: true });
              }}
              className="text-center text-sm text-paper-soft underline-offset-2 hover:text-paper hover:underline disabled:opacity-40"
            >
              {ce.usernameTakenCancelCta}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (screen.kind === 'success') {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm space-y-6">
          <h1 className="font-display text-3xl italic tracking-tight text-aurora-200 lg:text-4xl">
            {c.successTitle}
          </h1>
          <p className="text-sm leading-relaxed text-paper-soft">{c.successBody}</p>

          {/* Biometric sync offer — only when a local unsynced biometric exists */}
          {screen.hasUnsyncedBiometric && (
            <div className="space-y-4 rounded-[var(--radius-card)] bg-aurora-700/10 px-4 py-4 ring-1 ring-inset ring-aurora-700/30">
              <p className="font-medium text-paper">{c.biometricSyncTitle}</p>
              <p className="text-sm leading-relaxed text-paper-soft">{c.biometricSyncBody}</p>
              <button
                type="button"
                onClick={() => setScreen({ kind: 'biometric_setup', busy: false, error: null })}
                className="w-full rounded-[var(--radius-card)] bg-aurora-700 px-4 py-3 text-sm font-medium text-paper transition-opacity hover:opacity-90"
              >
                {c.biometricSyncCta}
              </button>
              <button
                type="button"
                onClick={() => navigate('/app', { replace: true })}
                className="w-full text-center text-sm text-paper-soft underline-offset-2 hover:text-paper hover:underline"
              >
                {c.biometricSyncSkipCta}
              </button>
            </div>
          )}

          {!screen.hasUnsyncedBiometric && (
            <button
              type="button"
              onClick={() => navigate('/app', { replace: true })}
              className="w-full rounded-[var(--radius-card)] bg-aurora-700 px-4 py-3 text-sm font-medium text-paper transition-opacity hover:opacity-90"
            >
              {c.finishCta}
            </button>
          )}
        </div>
      </div>
    );
  }

  if (screen.kind === 'biometric_setup') {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm space-y-6">
          <h1 className="font-display text-3xl italic tracking-tight text-aurora-200 lg:text-4xl">
            {c.biometricSyncTitle}
          </h1>
          <p className="text-sm leading-relaxed text-paper-soft">{c.biometricSyncBody}</p>

          {screen.error && (
            <p role="alert" className="text-sm text-danger">
              {screen.error}
            </p>
          )}

          <div className="flex flex-col gap-3">
            <button
              type="button"
              disabled={screen.busy}
              onClick={() => void handleBiometricSync()}
              className="w-full rounded-[var(--radius-card)] bg-aurora-700 px-4 py-3 text-sm font-medium text-paper transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              {screen.busy ? 'Setting up…' : c.biometricSyncCta}
            </button>
            <button
              type="button"
              disabled={screen.busy}
              onClick={() => navigate('/app', { replace: true })}
              className="text-center text-sm text-paper-soft underline-offset-2 hover:text-paper hover:underline disabled:opacity-40"
            >
              {c.biometricSyncSkipCta}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (screen.kind === 'error') {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm space-y-6">
          <div className="rounded-[var(--radius-card)] bg-danger/10 px-4 py-4 ring-1 ring-inset ring-danger/30">
            <p className="font-medium text-danger">{screen.message}</p>
          </div>
          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={() => setScreen({ kind: 'confirm' })}
              className="w-full rounded-[var(--radius-card)] bg-aurora-700 px-4 py-3 text-sm font-medium text-paper transition-opacity hover:opacity-90"
            >
              Try again
            </button>
            <Link
              to="/settings/server-linking"
              className="text-center text-sm text-paper-soft underline-offset-2 hover:text-paper hover:underline"
            >
              {c.cancelCta}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

// ── buildRegistrationResponseJson ────────────────────────────────────────────

/**
 * Serialise a raw `PublicKeyCredential` (from `credentials.create()`) into the
 * `RegistrationResponseJSON` shape expected by `addPasskeyPostLink`. This is a
 * manual serialisation because the user-client does not bundle
 * `@simplewebauthn/browser`.
 */
function buildRegistrationResponseJson(
  credential: PublicKeyCredential,
  response: AuthenticatorAttestationResponse,
): RegistrationResponseJSON {
  function b64url(buf: ArrayBuffer): string {
    return btoa(String.fromCharCode(...new Uint8Array(buf)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  }

  const transports =
    typeof response.getTransports === 'function'
      ? (response.getTransports() as (
          | 'ble'
          | 'cable'
          | 'hybrid'
          | 'internal'
          | 'nfc'
          | 'smart-card'
          | 'usb'
        )[])
      : [];

  return {
    id: b64url(credential.rawId),
    rawId: b64url(credential.rawId),
    response: {
      clientDataJSON: b64url(response.clientDataJSON),
      attestationObject: b64url(response.attestationObject),
      transports,
    },
    type: 'public-key',
    clientExtensionResults: {},
  };
}
