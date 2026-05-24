// SPDX-License-Identifier: AGPL-3.0-only

import {
  CryptoError,
  type PasskeyCredentialRow,
  deletePasskeyCredential,
  listLocalBiometric,
  regenerateRecoveryKey,
} from '@chatsundere/crypto';
import { ConfirmTyped, InlineMarker, useSessionStore } from '@chatsundere/ui-shared';
import { useEffect, useState } from 'react';
import { getDb } from '../../../boot/open-db.js';
import { RecoveryKeyReveal } from '../../../components/RecoveryKeyReveal.js';
import { copy } from '../../../lib/copy.js';
import { renamePasskey } from '../../../lib/passkey-management.js';
import { isWebAuthnAvailable } from '../../../lib/webauthn-availability.js';
import { PrfRequiredError, registerLocalBiometric } from '../../../lib/webauthn.js';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; passkeys: PasskeyCredentialRow[] }
  | { kind: 'error'; message: string };

/** In-place rename state for a single passkey row. */
type RenameState =
  | { kind: 'idle' }
  | { kind: 'editing'; draft: string; busy: boolean; error: string | null };

/** Which passkey (by index) is pending removal confirmation. */
type RemoveState =
  | { kind: 'none' }
  | { kind: 'normal'; credentialId: Uint8Array; busy: boolean }
  | { kind: 'lockout'; credentialId: Uint8Array; busy: boolean };

/** Recovery key regeneration flow state. */
type RegenState =
  | { kind: 'idle' }
  | { kind: 'confirm' }
  | { kind: 'busy' }
  | { kind: 'done'; key: string };

/** Add-biometric flow state. */
type AddBiometricState = { kind: 'idle' } | { kind: 'busy' } | { kind: 'error'; message: string };

/**
 * Authentication methods accordion body.
 *
 * Lists passphrase (immutable), local biometric credentials (renameable,
 * removable with lockout guard), and the recovery key indicator.
 *
 * Bottom actions: add a new biometric to this device and regenerate the
 * recovery key.
 */
export function AuthMethodsSection() {
  const [loadState, setLoadState] = useState<LoadState>({ kind: 'loading' });
  const [renameStates, setRenameStates] = useState<Map<string, RenameState>>(new Map());
  const [removeState, setRemoveState] = useState<RemoveState>({ kind: 'none' });
  const [regenState, setRegenState] = useState<RegenState>({ kind: 'idle' });
  const [addState, setAddState] = useState<AddBiometricState>({ kind: 'idle' });

  // Load biometrics on mount.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const rows = await listLocalBiometric(getDb());
        if (cancelled) return;
        setLoadState({ kind: 'ready', passkeys: rows });
      } catch {
        if (!cancelled) {
          setLoadState({ kind: 'error', message: 'Could not load authentication methods.' });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Helpers to convert credentialId to a stable key for map lookups.
  function credKey(id: Uint8Array): string {
    return Array.from(id)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  }

  function getRenameState(id: Uint8Array): RenameState {
    return renameStates.get(credKey(id)) ?? { kind: 'idle' };
  }

  function setRenameState(id: Uint8Array, state: RenameState) {
    setRenameStates((prev) => {
      const next = new Map(prev);
      next.set(credKey(id), state);
      return next;
    });
  }

  async function handleSaveRename(credentialId: Uint8Array, newLabel: string) {
    setRenameState(credentialId, { kind: 'editing', draft: newLabel, busy: true, error: null });
    try {
      await renamePasskey({ db: getDb(), credentialId, newLabel });
      // Update the local list to reflect the renamed label.
      if (loadState.kind === 'ready') {
        setLoadState({
          kind: 'ready',
          passkeys: loadState.passkeys.map((p) =>
            credKey(p.credential_id) === credKey(credentialId) ? { ...p, label: newLabel } : p,
          ),
        });
      }
      setRenameState(credentialId, { kind: 'idle' });
    } catch {
      setRenameState(credentialId, {
        kind: 'editing',
        draft: newLabel,
        busy: false,
        error: 'Could not rename. Please try again.',
      });
    }
  }

  function requestRemove(credentialId: Uint8Array) {
    if (loadState.kind !== 'ready') return;
    // Guard: if this is the last passkey, warn about lockout.
    const isLast = loadState.passkeys.length === 1;
    setRemoveState(
      isLast
        ? { kind: 'lockout', credentialId, busy: false }
        : { kind: 'normal', credentialId, busy: false },
    );
  }

  async function confirmRemove() {
    if (removeState.kind === 'none') return;
    const { credentialId } = removeState;
    setRemoveState({ ...removeState, busy: true });
    try {
      await deletePasskeyCredential(getDb(), credentialId);
      if (loadState.kind === 'ready') {
        setLoadState({
          kind: 'ready',
          passkeys: loadState.passkeys.filter(
            (p) => credKey(p.credential_id) !== credKey(credentialId),
          ),
        });
      }
      setRemoveState({ kind: 'none' });
    } catch {
      setRemoveState({ kind: 'none' });
    }
  }

  async function confirmRegen() {
    // mk is only present when the session was opened via passphrase or
    // recovery-key (not biometric). If absent, we cannot safely regenerate
    // without re-authentication.
    const { mk } = useSessionStore.getState();
    if (!mk) {
      setRegenState({ kind: 'idle' });
      return;
    }
    setRegenState({ kind: 'busy' });
    try {
      const { recoveryKeyString } = await regenerateRecoveryKey({ db: getDb(), mk });
      setRegenState({ kind: 'done', key: recoveryKeyString });
    } catch (e) {
      if (e instanceof CryptoError) {
        // CryptoError.message is internal — log it for debugging but surface a generic message.
        void e;
      }
      setRegenState({ kind: 'idle' });
    }
  }

  async function handleAddBiometric() {
    setAddState({ kind: 'busy' });
    try {
      await registerLocalBiometric(copy.settings.authMethods.addBiometricDefaultLabel);
      const rows = await listLocalBiometric(getDb());
      setLoadState({ kind: 'ready', passkeys: rows });
      setAddState({ kind: 'idle' });
    } catch (e) {
      // User-initiated cancellation (Esc, system dismiss) is silent — back to idle.
      if (e instanceof DOMException && (e.name === 'NotAllowedError' || e.name === 'AbortError')) {
        setAddState({ kind: 'idle' });
        return;
      }
      const message =
        e instanceof PrfRequiredError
          ? copy.settings.authMethods.addBiometricPrfRequired
          : copy.settings.authMethods.addBiometricGenericError;
      setAddState({ kind: 'error', message });
    }
  }

  // Recovery key regeneration is only possible when the store carries the raw
  // master key (passphrase or recovery-key login). Biometric-only sessions do not.
  const canRegen = useSessionStore.getState().mk !== null;
  const webAuthnAvailable = isWebAuthnAvailable();
  const addBusy = addState.kind === 'busy';
  const canAdd = webAuthnAvailable && !addBusy;

  if (loadState.kind === 'loading') {
    return <p className="text-paper-soft">Loading…</p>;
  }

  if (loadState.kind === 'error') {
    return <p className="text-sm text-danger">{loadState.message}</p>;
  }

  const { passkeys } = loadState;

  // Remove confirm dialog state.
  const removeOpen = removeState.kind === 'normal' || removeState.kind === 'lockout';
  const removeBusy = removeOpen && removeState.busy;
  const isLockout = removeState.kind === 'lockout';

  return (
    <div className="space-y-10">
      {/* Passphrase row — immutable */}
      <div className="space-y-3">
        <p className="text-xs font-medium uppercase tracking-wider text-paper-soft">
          {copy.settings.authMethods.passphraseLabel}
        </p>
        <div className="flex items-center justify-between rounded-[var(--radius-card)] bg-ink-soft px-4 py-3 ring-1 ring-inset ring-aurora-700/20">
          <span className="font-mono text-sm text-paper">
            {copy.settings.authMethods.passphraseLabel}
          </span>
          <span className="text-xs text-paper-soft">
            {copy.settings.authMethods.passphraseDescription}
          </span>
        </div>
      </div>

      {/* Biometric credentials */}
      <div className="space-y-3">
        <p className="text-xs font-medium uppercase tracking-wider text-paper-soft">
          {copy.settings.authMethods.biometricSectionLabel}
        </p>
        {passkeys.length === 0 ? (
          <p className="text-sm text-paper-soft">No biometrics set up on this device.</p>
        ) : (
          <ul className="space-y-2">
            {passkeys.map((pk) => {
              const key = credKey(pk.credential_id);
              const rs = getRenameState(pk.credential_id);
              return (
                <li
                  key={key}
                  className="rounded-[var(--radius-card)] bg-ink-soft px-4 py-3 ring-1 ring-inset ring-aurora-700/20"
                >
                  {rs.kind === 'editing' ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void handleSaveRename(pk.credential_id, rs.draft);
                      }}
                      className="flex gap-2"
                    >
                      <input
                        type="text"
                        value={rs.draft}
                        onChange={(e) =>
                          setRenameState(pk.credential_id, { ...rs, draft: e.target.value })
                        }
                        autoComplete="off"
                        disabled={rs.busy}
                        className="min-w-0 flex-1 rounded-[var(--radius-input)] bg-ink px-3 py-1.5 font-mono text-sm text-paper ring-1 ring-inset ring-aurora-700/40 focus:outline-none focus:ring-aurora-500 disabled:opacity-50"
                      />
                      <button
                        type="submit"
                        disabled={rs.busy || rs.draft.trim().length === 0}
                        className="rounded-[var(--radius-card)] bg-aurora-700 px-3 py-1.5 text-xs font-medium text-paper disabled:opacity-40"
                      >
                        {copy.settings.authMethods.renameSaveCta}
                      </button>
                      <button
                        type="button"
                        onClick={() => setRenameState(pk.credential_id, { kind: 'idle' })}
                        disabled={rs.busy}
                        className="rounded-[var(--radius-card)] bg-ink px-3 py-1.5 text-xs font-medium text-paper-soft ring-1 ring-inset ring-aurora-700/30 disabled:opacity-40"
                      >
                        {copy.settings.authMethods.renameSaveCta === 'Save' ? 'Cancel' : 'Cancel'}
                      </button>
                    </form>
                  ) : (
                    <div className="flex items-center justify-between gap-4">
                      <div className="min-w-0">
                        <p className="truncate font-mono text-sm text-paper">{pk.label}</p>
                        {pk.aaguid && (
                          <p className="mt-1">
                            <InlineMarker tone="default">{pk.aaguid}</InlineMarker>
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            setRenameState(pk.credential_id, {
                              kind: 'editing',
                              draft: pk.label,
                              busy: false,
                              error: null,
                            })
                          }
                          className="text-xs text-paper-soft underline-offset-2 hover:text-paper hover:underline"
                        >
                          {copy.settings.authMethods.renameCta}
                        </button>
                        <button
                          type="button"
                          onClick={() => requestRemove(pk.credential_id)}
                          className="text-xs text-danger underline-offset-2 hover:underline"
                        >
                          {copy.settings.authMethods.removeCta}
                        </button>
                      </div>
                    </div>
                  )}
                  {rs.kind === 'editing' && rs.error && (
                    <p className="mt-1 text-xs text-danger">{rs.error}</p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Recovery key indicator */}
      <div className="space-y-3">
        <p className="text-xs font-medium uppercase tracking-wider text-paper-soft">
          {copy.settings.authMethods.recoveryKeyLabel}
        </p>
        <div className="flex items-center justify-between rounded-[var(--radius-card)] bg-ink-soft px-4 py-3 ring-1 ring-inset ring-aurora-700/20">
          <span className="font-mono text-sm text-paper">
            {copy.settings.authMethods.recoveryKeyLabel}
          </span>
          <span className="text-xs text-paper-soft">
            {copy.settings.authMethods.recoveryKeyDescription}
          </span>
        </div>
      </div>

      {/* Bottom actions */}
      <div className="flex flex-col gap-3">
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => void handleAddBiometric()}
            disabled={!canAdd}
            title={
              webAuthnAvailable ? undefined : copy.settings.authMethods.addBiometricUnsupported
            }
            className="w-full rounded-[var(--radius-card)] bg-ink-soft px-4 py-3 text-sm font-medium text-paper ring-1 ring-inset ring-aurora-700/30 transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {addBusy
              ? copy.settings.authMethods.addBiometricBusyCta
              : copy.settings.authMethods.addBiometricCta}
          </button>
          {addState.kind === 'error' && <p className="text-xs text-danger">{addState.message}</p>}
        </div>
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setRegenState({ kind: 'confirm' })}
            disabled={!canRegen}
            title={canRegen ? undefined : copy.settings.authMethods.regenerateRecoveryDisabledHint}
            className="w-full rounded-[var(--radius-card)] bg-ink-soft px-4 py-3 text-sm font-medium text-paper ring-1 ring-inset ring-aurora-700/30 transition-opacity hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {copy.settings.authMethods.regenerateRecoveryCta}
          </button>
          {!canRegen && (
            <p className="text-xs text-paper-soft">
              {copy.settings.authMethods.regenerateRecoveryDisabledHint}
            </p>
          )}
        </div>
      </div>

      {/* Recovery key reveal — shown after successful regeneration */}
      {regenState.kind === 'done' && (
        <div className="space-y-4 rounded-[var(--radius-card)] bg-ink-soft p-5 ring-1 ring-inset ring-aurora-700/40">
          <p className="text-sm font-medium text-paper">
            Your new recovery key. Store it somewhere safe — you will not see it again.
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

      {/* Remove biometric confirm */}
      <ConfirmTyped
        open={removeOpen}
        title={
          isLockout
            ? copy.settings.authMethods.confirmLockoutTitle
            : copy.settings.authMethods.confirmRemoveTitle
        }
        body={
          isLockout
            ? copy.settings.authMethods.confirmLockoutBody
            : copy.settings.authMethods.confirmRemoveBody
        }
        confirmToken={copy.settings.authMethods.confirmRemoveToken}
        confirmTokenLabel={`"${copy.settings.authMethods.confirmRemoveToken}"`}
        destructiveCta={copy.settings.authMethods.confirmRemoveCta}
        cancelCta="Cancel"
        busy={removeBusy}
        onCancel={() => setRemoveState({ kind: 'none' })}
        onConfirm={() => void confirmRemove()}
      />

      {/* Regenerate recovery key confirm */}
      <ConfirmTyped
        open={regenState.kind === 'confirm'}
        title="Generate a new recovery key?"
        body="Your current recovery key will be invalidated immediately. Make sure you save the new one before you leave this screen."
        confirmToken="regenerate"
        confirmTokenLabel='"regenerate"'
        destructiveCta="Generate new key"
        cancelCta="Cancel"
        busy={regenState.kind === 'busy'}
        onCancel={() => setRegenState({ kind: 'idle' })}
        onConfirm={() => void confirmRegen()}
      />
    </div>
  );
}
