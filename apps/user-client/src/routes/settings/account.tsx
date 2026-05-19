// SPDX-License-Identifier: AGPL-3.0-only

import {
  CryptoError,
  changeUsername,
  deleteLocalAccount,
  getLocalAccount,
} from '@chatsundere/crypto';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getDb } from '../../boot/open-db.js';
import { ConfirmTyped } from '../../components/ConfirmTyped.js';
import { copy } from '../../lib/copy.js';
import { useSessionStore } from '../../state/session.store.js';

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; username: string; createdAt: Date }
  | { kind: 'error'; message: string };

/**
 * Account settings tab.
 *
 * Shows username (with inline rename), account creation date, and the
 * destructive "Delete local data" action.
 */
export function Account() {
  const navigate = useNavigate();
  const [loadState, setLoadState] = useState<LoadState>({ kind: 'loading' });

  // Inline edit state.
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveBusy, setSaveBusy] = useState(false);

  // Delete confirm dialog.
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const row = await getLocalAccount(getDb());
        if (cancelled) return;
        if (!row) {
          navigate('/onboarding', { replace: true });
          return;
        }
        setLoadState({ kind: 'ready', username: row.username, createdAt: row.created_at });
      } catch {
        if (!cancelled) setLoadState({ kind: 'error', message: 'Could not load account data.' });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [navigate]);

  function startEdit(currentUsername: string) {
    setDraft(currentUsername);
    setSaveError(null);
    setEditing(true);
  }

  async function saveUsername() {
    if (loadState.kind !== 'ready') return;
    setSaveBusy(true);
    setSaveError(null);
    try {
      await changeUsername({ db: getDb(), newUsername: draft });
      setLoadState({ ...loadState, username: draft });
      setEditing(false);
    } catch (e) {
      if (e instanceof CryptoError && e.code === 'invalid_input') {
        setSaveError(copy.errors.usernameInvalid);
      } else {
        setSaveError('Could not save the new username. Please try again.');
      }
    } finally {
      setSaveBusy(false);
    }
  }

  function handleSignOut() {
    useSessionStore.getState().closeAndForget();
    navigate('/login', { replace: true });
  }

  async function handleDelete() {
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await deleteLocalAccount(getDb());
      useSessionStore.getState().closeAndForget();
      navigate('/onboarding', { replace: true });
    } catch {
      setDeleteError('Could not delete local data. Please try again.');
      setDeleteBusy(false);
      setDeleteOpen(false);
    }
  }

  if (loadState.kind === 'loading') {
    return <p className="text-paper-soft">Loading…</p>;
  }

  if (loadState.kind === 'error') {
    return <p className="text-sm text-danger">{loadState.message}</p>;
  }

  const { username, createdAt } = loadState;

  return (
    <section className="space-y-10">
      <h2 className="font-display text-2xl italic text-paper">{copy.settings.account.title}</h2>

      {/* Username */}
      <div className="space-y-3">
        <p className="text-xs font-medium uppercase tracking-wider text-paper-soft">
          {copy.settings.account.usernameLabel}
        </p>
        {editing ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void saveUsername();
            }}
            className="flex gap-2"
          >
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              disabled={saveBusy}
              className="min-w-0 flex-1 rounded-[var(--radius-input)] bg-ink px-3 py-2 font-mono text-sm text-paper ring-1 ring-inset ring-aurora-700/40 focus:outline-none focus:ring-aurora-500 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={saveBusy || draft.trim().length === 0}
              className="rounded-[var(--radius-card)] bg-aurora-700 px-4 py-2 text-sm font-medium text-paper disabled:opacity-40"
            >
              {copy.settings.account.saveCta}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              disabled={saveBusy}
              className="rounded-[var(--radius-card)] bg-ink-soft px-4 py-2 text-sm font-medium text-paper-soft ring-1 ring-inset ring-aurora-700/30 disabled:opacity-40"
            >
              {copy.settings.account.cancelCta}
            </button>
          </form>
        ) : (
          <div className="flex items-center gap-4">
            <span className="font-mono text-base text-paper">{username}</span>
            <button
              type="button"
              onClick={() => startEdit(username)}
              className="text-xs text-paper-soft underline-offset-2 hover:text-paper hover:underline"
            >
              {copy.settings.account.editCta}
            </button>
          </div>
        )}
        {saveError && (
          <p role="alert" className="text-xs text-danger">
            {saveError}
          </p>
        )}
      </div>

      {/* Created at */}
      <div className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wider text-paper-soft">
          {copy.settings.account.createdAtLabel}
        </p>
        <p className="font-mono text-sm text-paper">
          {createdAt.toLocaleDateString('en-GB', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })}
        </p>
      </div>

      {/* Sign out — non-destructive: keeps the encrypted data on the device. */}
      <div className="space-y-3">
        <p className="text-xs font-medium uppercase tracking-wider text-paper-soft">
          {copy.settings.account.signOutSection}
        </p>
        <p className="text-sm leading-relaxed text-paper-soft">
          {copy.settings.account.signOutBody}
        </p>
        <button
          type="button"
          onClick={handleSignOut}
          className="rounded-[var(--radius-card)] bg-ink-soft px-4 py-2.5 text-sm font-medium text-paper ring-1 ring-inset ring-aurora-700/30 transition-opacity hover:opacity-80"
        >
          {copy.settings.account.signOutCta}
        </button>
      </div>

      {/* Delete local data */}
      <div className="space-y-4 rounded-[var(--radius-card)] border border-danger/30 p-5">
        <h3 className="font-medium text-danger">{copy.settings.account.deleteSection}</h3>
        <p className="text-sm leading-relaxed text-paper-soft">
          {copy.settings.account.deleteBody}
        </p>
        {deleteError && (
          <p role="alert" className="text-xs text-danger">
            {deleteError}
          </p>
        )}
        <button
          type="button"
          onClick={() => setDeleteOpen(true)}
          className="rounded-[var(--radius-card)] bg-danger/10 px-4 py-2.5 text-sm font-medium text-danger ring-1 ring-inset ring-danger/30 transition-opacity hover:opacity-90"
        >
          {copy.settings.account.deleteCta}
        </button>
      </div>

      <ConfirmTyped
        open={deleteOpen}
        title={copy.settings.account.confirmDeleteTitle}
        body={copy.settings.account.confirmDeleteBody}
        confirmToken={username}
        confirmTokenLabel={copy.settings.account.confirmTokenLabel}
        destructiveCta={copy.settings.account.confirmDeleteCta}
        cancelCta={copy.settings.account.confirmCancelCta}
        busy={deleteBusy}
        onCancel={() => setDeleteOpen(false)}
        onConfirm={() => void handleDelete()}
      />
    </section>
  );
}
