// SPDX-License-Identifier: AGPL-3.0-only

import { ConfirmTyped, useAccountLinkStore, useSessionStore } from '@chatsundere/ui-shared';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../../components/ui/Button.js';
import { PageScaffold } from '../../../components/ui/PageScaffold.js';
import { useHelp } from '../../../content/help/use-help.js';
import { HttpError } from '../../../lib/fetch.js';
import { httpServerClient } from '../../../lib/server-client.js';
import { wipeDevice } from '../../../lib/wipe-device.js';

/**
 * Logout sub-page — the "leaving" surface.
 *
 * Three actions:
 * - Sign out: closes the session and returns to /login. Encrypted data stays on
 *   the device and the user can log back in later.
 * - Delete all my local data: the complete device wipe (`wipeDevice`): every
 *   local database, Web Storage, Cache Storage and the service worker — the
 *   same erase "Start over" performs. On a linked account the server copy
 *   stays and the dialog says so.
 * - Delete my account everywhere (linked accounts only): deletes the server
 *   account first (`DELETE /api/v1/me`, Tier-3 step-up via the interceptor),
 *   then wipes the device. Server-first, offline-refuse: if the server call
 *   fails, nothing is deleted anywhere. The primary admin is refused with the
 *   constructive path (transfer the role first) — disabled over hidden.
 *
 * Both destructive paths are gated behind a typed-username confirm; the "No"
 * cancel is gold-protected ("gold protects, never invites").
 */
export function LogoutPage(): JSX.Element {
  const { onHelp, helpOverlay } = useHelp('logout');
  const navigate = useNavigate();

  // Read the current username for the delete confirmation token.
  const username = useSessionStore((s) => s.session?.username ?? '');
  const linkStatus = useAccountLinkStore((s) => s.linkStatus);
  const linkedBaseUrl = useAccountLinkStore((s) => s.baseUrl);
  const role = useAccountLinkStore((s) => s.role);

  const isLinked = linkStatus === 'linked';
  const isPrimaryAdmin = role === 'primary_admin';

  const [confirmOpen, setConfirmOpen] = useState<'none' | 'local' | 'everywhere'>('none');
  const [busy, setBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function signOut(): void {
    useSessionStore.getState().closeAndForget();
    navigate('/login');
  }

  async function reallyDeleteLocal(): Promise<void> {
    setBusy(true);
    setDeleteError(null);
    try {
      // The complete wipe: closes and deletes all three local databases,
      // clears Web Storage / Cache Storage / the service worker, revokes the
      // server session, and navigates to /onboarding itself.
      await wipeDevice();
    } catch {
      setDeleteError('Could not delete local data. Please try again.');
      setBusy(false);
      setConfirmOpen('none');
    }
  }

  async function reallyDeleteEverywhere(): Promise<void> {
    setBusy(true);
    setDeleteError(null);
    try {
      // Server-first: if this fails, nothing has been deleted anywhere and we
      // say so. A Tier-3 step-up challenge is handled by the fetch interceptor.
      await httpServerClient.deleteMe(linkedBaseUrl ?? '', '');
    } catch (e) {
      // Branch on the envelope code, not the bare status: DELETE /api/v1/me
      // also emits 403 step_up_required (e.g. the user cancelled the step-up
      // modal), which must not masquerade as the primary-admin refusal.
      if (e instanceof HttpError && e.status === 403 && e.code === 'forbidden') {
        setDeleteError(
          'The server refused: transfer your primary-admin role to another admin first.',
        );
      } else {
        setDeleteError(
          "Couldn't reach your server, so nothing was deleted. Try again when you're back online.",
        );
      }
      setBusy(false);
      setConfirmOpen('none');
      return;
    }
    try {
      await wipeDevice();
    } catch {
      setDeleteError(
        'Your server account is deleted, but this device could not be fully wiped. Please try "Delete all my local data" again.',
      );
      setBusy(false);
      setConfirmOpen('none');
    }
  }

  return (
    <PageScaffold
      back="/app/account"
      crumbs={[{ label: 'My Account', to: '/app/account' }, { label: 'Logout' }]}
      onHelp={onHelp}
    >
      {helpOverlay}

      {/* Sign out — non-destructive; encrypted data remains on the device. */}
      <div className="space-y-3">
        <Button tone="neutral" onClick={signOut}>
          Sign out
        </Button>
        <p className="text-xs text-paper-soft">Your encrypted data stays on this device.</p>
      </div>

      {/* Destructive danger zone. */}
      <div className="mt-6 space-y-4 rounded-xl border border-destructive/40 p-4">
        {deleteError && (
          <p role="alert" className="text-xs text-danger">
            {deleteError}
          </p>
        )}

        <div className="space-y-2">
          <Button tone="destructive" onClick={() => setConfirmOpen('local')} disabled={busy}>
            Delete all my local data
          </Button>
          {isLinked && (
            <p className="text-xs text-paper-soft">
              Wipes this device only. Your account and encrypted data stay on the server.
            </p>
          )}
        </div>

        {isLinked && (
          <div className="space-y-2">
            <Button
              tone="destructive"
              onClick={() => setConfirmOpen('everywhere')}
              disabled={busy || isPrimaryAdmin}
              title={
                isPrimaryAdmin
                  ? 'Transfer your primary-admin role to another admin first.'
                  : undefined
              }
            >
              Delete my account everywhere
            </Button>
            <p className="text-xs text-paper-soft">
              {isPrimaryAdmin
                ? 'You are the primary admin. Transfer the role to another admin in the admin console first.'
                : 'Deletes your account on the server and wipes this device.'}
            </p>
          </div>
        )}
      </div>

      {/* Delete local data confirm */}
      <ConfirmTyped
        open={confirmOpen === 'local'}
        title="Delete everything on this device?"
        body={
          isLinked
            ? 'This permanently deletes all data on this device. Your account and encrypted data stay on the server — your recovery key can bring them back. Type your username to confirm.'
            : 'This permanently deletes all your local data. There is no recovery. Type your username to confirm.'
        }
        confirmToken={username}
        confirmTokenLabel="Type your username"
        destructiveCta="Yes, delete"
        cancelCta="No"
        protectCancel
        busy={busy}
        onCancel={() => setConfirmOpen('none')}
        onConfirm={() => void reallyDeleteLocal()}
      />

      {/* Delete account everywhere confirm */}
      <ConfirmTyped
        open={confirmOpen === 'everywhere'}
        title="Delete your account everywhere?"
        body="This permanently deletes your account and all encrypted data on the server, then wipes this device. Other devices can no longer reach the server, but anything already on them stays until you wipe each one. There is no recovery. Type your username to confirm."
        confirmToken={username}
        confirmTokenLabel="Type your username"
        destructiveCta="Yes, delete everywhere"
        cancelCta="No"
        protectCancel
        busy={busy}
        onCancel={() => setConfirmOpen('none')}
        onConfirm={() => void reallyDeleteEverywhere()}
      />
    </PageScaffold>
  );
}
