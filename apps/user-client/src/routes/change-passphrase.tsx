// SPDX-License-Identifier: AGPL-3.0-only

import {
  CryptoError,
  type MasterKey,
  addIntegrityHmac,
  aeadEncrypt,
  changePassphraseLinkedOnline,
  changePassphraseLocalOnly,
  deriveIntegrityKey,
  deriveOpaqueAmk,
  getLinkedAccount,
  getLocalAccount,
  opaqueRegistrationFinish,
  opaqueRegistrationStart,
  toBase64Url,
} from '@chatsundere/crypto';
import { useConnectivityStore, useSessionStore } from '@chatsundere/ui-shared';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import * as v from 'valibot';
import { getDb } from '../boot/open-db.js';
import { PassphraseField } from '../components/PassphraseField.js';
import { copy } from '../lib/copy.js';
import { HttpError } from '../lib/fetch.js';
import { httpServerClient } from '../lib/server-client.js';
import { PassphrasePair } from '../lib/validators.js';

// ── Screen state ─────────────────────────────────────────────────────────────

type Screen =
  | { kind: 'form'; busy: boolean; error: string | null }
  | { kind: 'offline-blocked' }
  | { kind: 'success' };

// ── Copy alias ────────────────────────────────────────────────────────────────

const c = copy.changePassphrase;

// ── Error mapping ─────────────────────────────────────────────────────────────

function mapError(err: unknown, newPassphrase: string, confirmPassphrase: string): string {
  // Validation errors are handled before submission; this covers crypto/network errors.
  if (err instanceof HttpError) {
    if (err.status === 429 && err.retryAfterSeconds !== undefined) {
      return c.errors.rateLimited.replace('{seconds}', String(err.retryAfterSeconds));
    }
    return c.errors.unknown;
  }
  if (err instanceof CryptoError) {
    return c.errors.unknown;
  }
  // Defensive fallback.
  void newPassphrase;
  void confirmPassphrase;
  return c.errors.unknown;
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * `/change-passphrase` — Change-passphrase flow with three branches:
 *
 * - Local-only account: `changePassphraseLocalOnly` from `@chatsundere/crypto`.
 * - Linked + online (`linked_online`): `changePassphraseLinkedOnline` with a
 *   `serverCommit` callback that performs the OPAQUE re-registration.
 * - Linked + offline (`server_unreachable` | `server_auth_failed`): renders a
 *   disabled surface pointing back to `/app/account`.
 *
 * Spec §5.7.
 */
export function ChangePassphrase() {
  const navigate = useNavigate();
  const connectivity = useConnectivityStore((s) => s.state);

  const [screen, setScreen] = useState<Screen>({ kind: 'form', busy: false, error: null });
  const [newPassphrase, setNewPassphrase] = useState('');
  const [confirmPassphrase, setConfirmPassphrase] = useState('');

  // Track unmount so async operations do not call setState on an unmounted component.
  const unmountedRef = useRef(false);
  useEffect(() => {
    unmountedRef.current = false;
    return () => {
      unmountedRef.current = true;
    };
  }, []);

  // Redirect if there is no active session — cannot change passphrase without mk.
  useEffect(() => {
    const session = useSessionStore.getState().session;
    if (!session) {
      navigate('/login', { replace: true });
    }
  }, [navigate]);

  // Detect offline-blocked state on mount and whenever connectivity changes.
  // We still render the form for `local_online` / `local_offline` (local-only account)
  // and for `linked_online`. Only block when linked + unreachable.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const kind = connectivity.kind;
      if (kind === 'server_unreachable' || kind === 'server_auth_failed') {
        // Confirm the user actually has a linked account before showing the blocked screen.
        // A `server_unreachable` state for an unlinked user should not happen in practice,
        // but guard defensively.
        try {
          const linked = await getLinkedAccount(getDb());
          if (!cancelled && linked) {
            setScreen({ kind: 'offline-blocked' });
          }
        } catch {
          // IDB read failure — fall through to the form; the submit path will surface the error.
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [connectivity.kind]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (screen.kind !== 'form' || screen.busy) return;

    setScreen({ kind: 'form', busy: false, error: null });

    // Client-side validation via Valibot.
    const pairResult = v.safeParse(PassphrasePair, {
      passphrase: newPassphrase,
      confirmation: confirmPassphrase,
    });
    if (!pairResult.success) {
      const issue = pairResult.issues[0];
      // Map the generic Valibot messages to our copy keys.
      let errorMsg: string;
      const msg = issue?.message ?? '';
      if (msg.includes('match')) {
        errorMsg = c.errors.mismatch;
      } else if (msg.includes('8') || msg.includes('characters')) {
        errorMsg = c.errors.tooShort;
      } else {
        errorMsg = c.errors.unknown;
      }
      setScreen({ kind: 'form', busy: false, error: errorMsg });
      return;
    }

    const { session, mk } = useSessionStore.getState();
    if (!session || !mk) {
      // mk is absent when signed in via biometric only — cannot change passphrase.
      setScreen({ kind: 'form', busy: false, error: c.errors.unknown });
      return;
    }

    setScreen({ kind: 'form', busy: true, error: null });

    try {
      const db = getDb();
      const [linked, local] = await Promise.all([getLinkedAccount(db), getLocalAccount(db)]);

      if (linked && connectivity.kind === 'linked_online') {
        // ── Linked + online path ─────────────────────────────────────────────
        // Build the serverCommit callback: performs OPAQUE re-registration with
        // the new passphrase and commits the new wrapped MK to the server.
        const capturedPassphrase = newPassphrase;
        const baseUrl = linked.base_url;
        const username = local?.username ?? '';
        // OPAQUE server-identity: an identity string for the OPAQUE handshake,
        // not a URL — both sides only need to agree on the same byte sequence,
        // so plain concatenation is correct here. Keep separate from joinUrl
        // (lib/fetch.ts), which is for actual HTTP request URLs.
        const serverIdentity = `${baseUrl}/auth/v1`;
        const accessToken = session.accessToken ?? '';
        // Capture mk into a typed local so the async callback closes over a
        // narrowed MasterKey rather than re-reading the store mid-flight.
        const capturedMk: MasterKey = mk;

        const serverCommit = async () => {
          const { clientRegistrationState, registrationRequest } =
            await opaqueRegistrationStart(capturedPassphrase);

          const startResp = await httpServerClient.passphraseChangeStart(
            { registration_request: registrationRequest },
            baseUrl,
            accessToken,
          );

          const { registrationRecord, exportKey } = await opaqueRegistrationFinish({
            clientRegistrationState,
            registrationResponse: startResp.registration_response,
            passphrase: capturedPassphrase,
            username,
            serverIdentity,
          });

          const opaqueAmk = await deriveOpaqueAmk(exportKey);
          const aad = new TextEncoder().encode(`${username}::opaque::v1`);
          const wrapped = await aeadEncrypt(opaqueAmk, capturedMk, aad);
          const ik = await deriveIntegrityKey(opaqueAmk);
          const tagged = await addIntegrityHmac(wrapped, ik);

          await httpServerClient.passphraseChangeFinish(
            {
              session_id: startResp.session_id,
              registration_record: toBase64Url(registrationRecord),
              wrapped_mk_opaque: toBase64Url(tagged.ciphertext),
              wrap_nonce_opaque: toBase64Url(tagged.nonce),
              wrap_aad_opaque: toBase64Url(tagged.aad),
            },
            baseUrl,
            accessToken,
          );
        };

        await changePassphraseLinkedOnline({
          db,
          session,
          mk,
          newPassphrase: capturedPassphrase,
          serverCommit,
        });
      } else {
        // ── Local-only path ──────────────────────────────────────────────────
        await changePassphraseLocalOnly({
          db,
          session,
          mk,
          newPassphrase,
        });
      }

      if (!unmountedRef.current) {
        setScreen({ kind: 'success' });
      }
    } catch (err) {
      if (!unmountedRef.current) {
        setScreen({
          kind: 'form',
          busy: false,
          error: mapError(err, newPassphrase, confirmPassphrase),
        });
      }
    }
  }

  // ── Offline-blocked surface ───────────────────────────────────────────────

  if (screen.kind === 'offline-blocked') {
    return (
      <section className="space-y-6 pt-8">
        <h1 className="font-display text-3xl italic tracking-tight text-paper lg:text-4xl">
          {c.offlineTitle}
        </h1>
        <p className="text-sm leading-relaxed text-paper-soft">{c.offlineBody}</p>
        <Link
          to="/app/account"
          className="inline-block rounded-[var(--radius-card)] bg-ink-soft px-4 py-3 text-sm font-medium text-paper ring-1 ring-inset ring-aurora-700/30 transition-opacity hover:opacity-80"
        >
          {c.offlineBackCta}
        </Link>
      </section>
    );
  }

  // ── Success surface ───────────────────────────────────────────────────────

  if (screen.kind === 'success') {
    return (
      <section className="space-y-6 pt-8">
        <h1 className="font-display text-3xl italic tracking-tight text-paper lg:text-4xl">
          {c.successTitle}
        </h1>
        <p className="text-sm leading-relaxed text-paper-soft">{c.successBody}</p>
        <Link
          to="/app/account"
          className="inline-block rounded-[var(--radius-card)] bg-aurora-700 px-4 py-3 text-sm font-medium text-paper transition-opacity hover:opacity-90"
        >
          {c.successCta}
        </Link>
      </section>
    );
  }

  // ── Form surface ──────────────────────────────────────────────────────────

  const { busy, error } = screen;

  return (
    <section className="space-y-6 pt-8">
      <div className="space-y-2">
        <h1 className="font-display text-3xl italic tracking-tight text-paper lg:text-4xl">
          {c.title}
        </h1>
        <p className="text-sm leading-relaxed text-paper-soft">{c.body}</p>
      </div>

      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-5">
        <PassphraseField
          id="new-passphrase"
          label={c.newLabel}
          value={newPassphrase}
          onChange={setNewPassphrase}
          meter
          autoComplete="new-password"
        />
        <PassphraseField
          id="confirm-passphrase"
          label={c.confirmLabel}
          value={confirmPassphrase}
          onChange={setConfirmPassphrase}
          autoComplete="new-password"
        />

        {error !== null && (
          <p role="alert" className="text-sm text-danger" aria-live="polite">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-[var(--radius-card)] bg-aurora-700 px-4 py-3 text-sm font-medium text-paper transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? c.workingCta : c.submitCta}
        </button>
      </form>
    </section>
  );
}
