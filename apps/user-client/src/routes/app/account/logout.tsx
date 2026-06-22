// SPDX-License-Identifier: AGPL-3.0-only

import { deleteLocalAccount } from '@chatsundere/crypto';
import { ConfirmTyped, useSessionStore } from '@chatsundere/ui-shared';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getDb } from '../../../boot/open-db.js';
import { Button } from '../../../components/ui/Button.js';
import { PageScaffold } from '../../../components/ui/PageScaffold.js';
import { useHelp } from '../../../content/help/use-help.js';

/**
 * Logout sub-page — the "leaving" surface.
 *
 * Two actions:
 * - Sign out: closes the session and returns to /login. Encrypted data stays on
 *   the device and the user can log back in later.
 * - Delete all my local data: permanently removes everything from this device.
 *   Gated behind a typed-username confirm; the "No" cancel is gold-protected
 *   ("gold protects, never invites").
 */
export function LogoutPage(): JSX.Element {
  const { onHelp, helpOverlay } = useHelp('logout');
  const navigate = useNavigate();

  // Read the current username for the delete confirmation token.
  const username = useSessionStore((s) => s.session?.username ?? '');

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function signOut(): void {
    useSessionStore.getState().closeAndForget();
    navigate('/login');
  }

  async function reallyDelete(): Promise<void> {
    setBusy(true);
    setDeleteError(null);
    try {
      await deleteLocalAccount(getDb());
      useSessionStore.getState().closeAndForget();
      navigate('/onboarding');
    } catch {
      setDeleteError('Could not delete local data. Please try again.');
      setBusy(false);
      setConfirmOpen(false);
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

      {/* Delete all local data — destructive danger zone. */}
      <div className="mt-6 space-y-4 rounded-xl border border-destructive/40 p-4">
        {deleteError && (
          <p role="alert" className="text-xs text-danger">
            {deleteError}
          </p>
        )}
        <Button tone="destructive" onClick={() => setConfirmOpen(true)} disabled={busy}>
          Delete all my local data
        </Button>
      </div>

      <ConfirmTyped
        open={confirmOpen}
        title="Delete everything on this device?"
        body="This permanently deletes all your local data. There is no recovery. Type your username to confirm."
        confirmToken={username}
        confirmTokenLabel="Type your username"
        destructiveCta="Yes, delete"
        cancelCta="No"
        protectCancel
        busy={busy}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => void reallyDelete()}
      />
    </PageScaffold>
  );
}
