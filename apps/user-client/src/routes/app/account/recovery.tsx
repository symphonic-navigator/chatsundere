// SPDX-License-Identifier: AGPL-3.0-only

import { CryptoError, regenerateRecoveryKey, toBase64Url } from '@chatsundere/crypto';
import { ConfirmTyped, useAccountLinkStore, useSessionStore } from '@chatsundere/ui-shared';
import { useState } from 'react';
import { getDb } from '../../../boot/open-db.js';
import { RecoveryKeyReveal } from '../../../components/RecoveryKeyReveal.js';
import { Button } from '../../../components/ui/Button.js';
import { PageScaffold } from '../../../components/ui/PageScaffold.js';
import { useHelp } from '../../../content/help/use-help.js';
import { copy } from '../../../lib/copy.js';
import { httpServerClient } from '../../../lib/server-client.js';

// ── State machine ─────────────────────────────────────────────────────────────

/** Recovery key regeneration flow state. */
type RegenState =
  | { kind: 'idle' }
  | { kind: 'confirm' }
  | { kind: 'busy' }
  | { kind: 'done'; key: string };

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * Recovery Key sub-page: lets the user regenerate their recovery key.
 *
 * The action is gated on the master key being present in the session store.
 * Biometric-only sessions do not carry the raw master key and therefore cannot
 * safely rotate the recovery key without re-authentication.
 *
 * For linked accounts the rotation is server-first: the new verifier key and
 * re-wrapped MK are pushed to `POST /api/v1/me/recovery` BEFORE the local row
 * is touched, so deviceless recovery always matches the key the user holds.
 * A failed server call leaves the old key fully valid — and we say so.
 */
export function RecoveryKeyPage(): JSX.Element {
  const { onHelp, helpOverlay } = useHelp('recovery');
  const mk = useSessionStore((s) => s.mk);
  const linkStatus = useAccountLinkStore((s) => s.linkStatus);
  const linkedBaseUrl = useAccountLinkStore((s) => s.baseUrl);
  const [regenState, setRegenState] = useState<RegenState>({ kind: 'idle' });
  const [error, setError] = useState<string | null>(null);

  // Refuse while the link state is still resolving (cold-boot race): defaulting
  // 'unknown' into the not-linked branch would let a genuinely linked account
  // rotate locally-only and desynchronise deviceless recovery. Fail safe.
  const canRegen = mk !== null && linkStatus !== 'unknown';
  const disabledHint =
    mk === null
      ? copy.settings.authMethods.regenerateRecoveryDisabledHint
      : linkStatus === 'unknown'
        ? 'One moment — still checking your server connection. Try again in a second.'
        : undefined;

  async function confirmRegen() {
    // Guard: mk must be present (passphrase or recovery-key session).
    const currentMk = useSessionStore.getState().mk;
    if (!currentMk) {
      setRegenState({ kind: 'idle' });
      return;
    }
    setRegenState({ kind: 'busy' });
    setError(null);

    // Linked accounts push the new material to the server FIRST — the crypto
    // flow calls this before writing anything locally, so a failure here means
    // nothing changed anywhere.
    const serverUpdate =
      linkStatus === 'linked' && linkedBaseUrl
        ? async (args: {
            new_recovery_verifier_key: Uint8Array;
            new_wrapped_mk_recovery_ciphertext: Uint8Array;
            new_wrapped_mk_recovery_nonce: Uint8Array;
            new_wrapped_mk_recovery_aad: Uint8Array;
          }): Promise<void> => {
            await httpServerClient.updateRecovery(
              {
                new_recovery_verifier_key: toBase64Url(args.new_recovery_verifier_key),
                new_wrapped_mk_recovery: toBase64Url(args.new_wrapped_mk_recovery_ciphertext),
                new_wrap_nonce_recovery: toBase64Url(args.new_wrapped_mk_recovery_nonce),
                new_wrap_aad_recovery: toBase64Url(args.new_wrapped_mk_recovery_aad),
              },
              linkedBaseUrl,
              '',
            );
          }
        : undefined;

    try {
      const { recoveryKeyString, localWriteFailed } = await regenerateRecoveryKey({
        db: getDb(),
        mk: currentMk,
        serverUpdate,
      });
      if (localWriteFailed) {
        // Tail failure on the linked path: the server accepted the new key
        // but this device could not store it. The key below is now the ONLY
        // one deviceless recovery accepts — it must be revealed, and the
        // split state named honestly.
        setError(
          'Your new key is registered with your server, but this device could not store it. ' +
            'Save the key below now. Recovery-key sign-in on THIS device still uses your old key ' +
            'until a later successful regeneration.',
        );
      }
      setRegenState({ kind: 'done', key: recoveryKeyString });
    } catch (e) {
      if (serverUpdate && !(e instanceof CryptoError)) {
        // Server or network failure on the linked path (HttpError or a network
        // TypeError): the server never accepted the new key, so the current
        // key is still fully valid — say so honestly.
        setError(
          "Couldn't reach your server, so your recovery key was NOT changed. " +
            'Your current key is still valid. Try again when you are back online.',
        );
      } else {
        setError('Something went wrong — your recovery key was not changed.');
      }
      setRegenState({ kind: 'idle' });
    }
  }

  return (
    <PageScaffold
      back="/app/account"
      crumbs={[{ label: 'My Account', to: '/app/account' }, { label: 'Recovery Key' }]}
      onHelp={onHelp}
    >
      {helpOverlay}

      <div className="space-y-6 px-4 pb-8 pt-2">
        <p className="text-sm text-paper-soft">
          Keep your recovery key where you won't lose it. A note in your password manager —
          Bitwarden, Proton Pass — is ideal: it's the one thing that brings your data back if you
          lose every device, and we can't recover it for you.
        </p>

        <div className="space-y-2">
          <Button
            tone="destructive"
            onClick={() => setRegenState({ kind: 'confirm' })}
            disabled={!canRegen}
            title={disabledHint}
            className="w-full"
          >
            {copy.settings.authMethods.regenerateRecoveryCta}
          </Button>
          {disabledHint && <p className="text-xs text-paper-soft">{disabledHint}</p>}
        </div>

        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}

        {/* Recovery key reveal — shown after successful regeneration */}
        {regenState.kind === 'done' && (
          <div className="space-y-4 rounded-[var(--radius-card)] bg-ink-soft p-5 ring-1 ring-inset ring-aurora-700/40">
            <p className="text-sm font-medium text-paper">
              Your new recovery key. Save it in your password manager now — you will not see it
              again.
            </p>
            <RecoveryKeyReveal value={regenState.key} />
            <button
              type="button"
              onClick={() => setRegenState({ kind: 'idle' })}
              className="text-xs text-paper-soft underline-offset-2 hover:text-paper hover:underline"
            >
              I have saved it
            </button>
          </div>
        )}
      </div>

      {/* Regenerate recovery key confirm */}
      <ConfirmTyped
        open={regenState.kind === 'confirm'}
        title="Generate a new recovery key?"
        body="Your current recovery key will be invalidated immediately. If your server can't be reached, nothing changes and your current key stays valid. Make sure you save the new one before you leave this screen."
        confirmToken="regenerate"
        confirmTokenLabel='"regenerate"'
        destructiveCta="Generate new key"
        cancelCta="Cancel"
        busy={regenState.kind === 'busy'}
        onCancel={() => setRegenState({ kind: 'idle' })}
        onConfirm={() => void confirmRegen()}
      />
    </PageScaffold>
  );
}
