// SPDX-License-Identifier: AGPL-3.0-only

import {
  type PasskeyCredentialRow,
  deletePasskeyCredential,
  listPasskeyCredentials,
} from '@chatsundere/crypto';
import { useEffect, useState } from 'react';
import { getDb } from '../../../boot/open-db.js';
import { Button } from '../../../components/ui/Button.js';
import { ConfirmDialog } from '../../../components/ui/ConfirmDialog.js';
import { ListRow } from '../../../components/ui/ListRow.js';
import { PageScaffold } from '../../../components/ui/PageScaffold.js';
import { useHelp } from '../../../content/help/use-help.js';
import { copy } from '../../../lib/copy.js';
import { renamePasskey } from '../../../lib/passkey-management.js';
import { isWebAuthnAvailable } from '../../../lib/webauthn-availability.js';
import { PrfRequiredError, registerLocalBiometric } from '../../../lib/webauthn.js';

// ── State machine types ───────────────────────────────────────────────────────

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; passkeys: PasskeyCredentialRow[] }
  | { kind: 'error'; message: string };

/** In-place rename state for a single passkey row. */
type RenameState =
  | { kind: 'idle' }
  | { kind: 'editing'; draft: string; busy: boolean; error: string | null };

/** Which passkey is pending removal confirmation. */
type RemoveState =
  | { kind: 'none' }
  | { kind: 'normal'; credentialId: Uint8Array; busy: boolean }
  | { kind: 'lockout'; credentialId: Uint8Array; busy: boolean };

/** Add-biometric flow state. */
type AddBiometricState = { kind: 'idle' } | { kind: 'busy' } | { kind: 'error'; message: string };

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Converts a credential ID to a stable hex string for map keys. */
function credKey(id: Uint8Array): string {
  return Array.from(id)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * Biometric sub-page: lists passkey credentials stored on this device, allows
 * renaming inline and removal (with last-one lockout warning), and provides an
 * "Add biometric" action gated on WebAuthn availability.
 */
export function BiometricPage(): JSX.Element {
  const { onHelp, helpOverlay } = useHelp('biometric');

  const [loadState, setLoadState] = useState<LoadState>({ kind: 'loading' });
  const [renameStates, setRenameStates] = useState<Map<string, RenameState>>(new Map());
  const [removeState, setRemoveState] = useState<RemoveState>({ kind: 'none' });
  const [addState, setAddState] = useState<AddBiometricState>({ kind: 'idle' });

  // Load biometrics on mount.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const rows = await listPasskeyCredentials(getDb());
        if (cancelled) return;
        setLoadState({ kind: 'ready', passkeys: rows });
      } catch {
        if (!cancelled) {
          setLoadState({ kind: 'error', message: 'Could not load biometrics.' });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function getRenameState(id: Uint8Array): RenameState {
    return renameStates.get(credKey(id)) ?? { kind: 'idle' };
  }

  function setRenameStateFor(id: Uint8Array, state: RenameState) {
    setRenameStates((prev) => {
      const next = new Map(prev);
      next.set(credKey(id), state);
      return next;
    });
  }

  async function handleSaveRename(credentialId: Uint8Array, newLabel: string) {
    setRenameStateFor(credentialId, { kind: 'editing', draft: newLabel, busy: true, error: null });
    try {
      await renamePasskey({ db: getDb(), credentialId, newLabel });
      if (loadState.kind === 'ready') {
        setLoadState({
          kind: 'ready',
          passkeys: loadState.passkeys.map((p) =>
            credKey(p.credential_id) === credKey(credentialId) ? { ...p, label: newLabel } : p,
          ),
        });
      }
      setRenameStateFor(credentialId, { kind: 'idle' });
    } catch {
      setRenameStateFor(credentialId, {
        kind: 'editing',
        draft: newLabel,
        busy: false,
        error: 'Could not rename. Please try again.',
      });
    }
  }

  function requestRemove(credentialId: Uint8Array) {
    if (loadState.kind !== 'ready') return;
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

  async function handleAddBiometric() {
    setAddState({ kind: 'busy' });
    try {
      await registerLocalBiometric(copy.settings.authMethods.addBiometricDefaultLabel);
      const rows = await listPasskeyCredentials(getDb());
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

  const webAuthnAvailable = isWebAuthnAvailable();
  const addBusy = addState.kind === 'busy';
  const canAdd = webAuthnAvailable && !addBusy;

  const removeOpen = removeState.kind === 'normal' || removeState.kind === 'lockout';
  const isLockout = removeState.kind === 'lockout';

  return (
    <PageScaffold
      back="/app/account"
      crumbs={[{ label: 'My Account', to: '/app/account' }, { label: 'Biometric' }]}
      onHelp={onHelp}
    >
      {helpOverlay}

      <div className="space-y-6 px-4 pb-8 pt-2">
        {loadState.kind === 'loading' && <p className="text-paper-soft">Loading…</p>}

        {loadState.kind === 'error' && <p className="text-sm text-danger">{loadState.message}</p>}

        {loadState.kind === 'ready' && (
          <>
            {loadState.passkeys.length === 0 ? (
              <p className="text-sm text-paper-soft">No biometrics set up on this device.</p>
            ) : (
              <ul className="space-y-2">
                {loadState.passkeys.map((pk) => {
                  const key = credKey(pk.credential_id);
                  const rs = getRenameState(pk.credential_id);

                  if (rs.kind === 'editing') {
                    return (
                      <li key={key}>
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
                              setRenameStateFor(pk.credential_id, { ...rs, draft: e.target.value })
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
                            onClick={() => setRenameStateFor(pk.credential_id, { kind: 'idle' })}
                            disabled={rs.busy}
                            className="rounded-[var(--radius-card)] bg-ink px-3 py-1.5 text-xs font-medium text-paper-soft ring-1 ring-inset ring-aurora-700/30 disabled:opacity-40"
                          >
                            Cancel
                          </button>
                        </form>
                        {rs.error && <p className="mt-1 text-xs text-danger">{rs.error}</p>}
                      </li>
                    );
                  }

                  return (
                    <li key={key}>
                      <ListRow
                        title={pk.label}
                        subtitle={pk.aaguid ?? undefined}
                        overflow={[
                          {
                            label: copy.settings.authMethods.renameCta,
                            onSelect: () =>
                              setRenameStateFor(pk.credential_id, {
                                kind: 'editing',
                                draft: pk.label,
                                busy: false,
                                error: null,
                              }),
                          },
                          {
                            label: copy.settings.authMethods.removeCta,
                            tone: 'destructive',
                            onSelect: () => requestRemove(pk.credential_id),
                          },
                        ]}
                      />
                    </li>
                  );
                })}
              </ul>
            )}

            {/* Add biometric action */}
            <div className="space-y-2">
              <Button
                tone="primary"
                priority
                onClick={() => void handleAddBiometric()}
                disabled={!canAdd}
                title={
                  webAuthnAvailable ? undefined : copy.settings.authMethods.addBiometricUnsupported
                }
                className="w-full"
              >
                {addBusy
                  ? copy.settings.authMethods.addBiometricBusyCta
                  : copy.settings.authMethods.addBiometricCta}
              </Button>
              {addState.kind === 'error' && (
                <p className="text-xs text-danger">{addState.message}</p>
              )}
            </div>
          </>
        )}
      </div>

      {/* Remove biometric confirm */}
      <ConfirmDialog
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
        confirmLabel={copy.settings.authMethods.confirmRemoveCta}
        cancelLabel="Cancel"
        destructive
        onCancel={() => setRemoveState({ kind: 'none' })}
        onConfirm={() => void confirmRemove()}
      />
    </PageScaffold>
  );
}
