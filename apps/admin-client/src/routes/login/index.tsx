// SPDX-License-Identifier: AGPL-3.0-only
import { loginOnlineLinked, openLocalDb } from '@chatsundere/crypto';
import {
  mapLoginErrorToCopyKey,
  useConnectivityStore,
  useSessionStore,
} from '@chatsundere/ui-shared';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { copy } from '../../copy.js';
import { httpServerClient } from '../../lib/server-client.js';
import {
  type PreLoginBranch,
  classifyPostLogin,
  runDecisionTreePreLogin,
} from './decision-tree.js';
import {
  NoAccountFailure,
  NoLinkFailure,
  NotAdminFailure,
  OfflineFailure,
} from './failure-states.js';

type ErrorCopyKey = keyof typeof copy.login.errors;

type State =
  | { kind: 'checking' }
  | { kind: 'failure'; branch: PreLoginBranch }
  | { kind: 'ready' }
  | { kind: 'role_not_admin' };

export function LoginScreen() {
  const navigate = useNavigate();
  const [state, setState] = useState<State>({ kind: 'checking' });
  const [passphrase, setPassphrase] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<ErrorCopyKey | null>(null);

  useEffect(() => {
    const runCheck = async () => {
      setState({ kind: 'checking' });
      const result = await runDecisionTreePreLogin();
      if (result.branch === 'ready') setState({ kind: 'ready' });
      else setState({ kind: 'failure', branch: result.branch });
    };
    void runCheck();
  }, []);

  const handleRetry = async () => {
    setState({ kind: 'checking' });
    const result = await runDecisionTreePreLogin();
    if (result.branch === 'ready') setState({ kind: 'ready' });
    else setState({ kind: 'failure', branch: result.branch });
  };

  if (state.kind === 'checking') {
    return (
      <main className="grid min-h-dvh place-items-center">
        <p className="text-[var(--color-subtext-0)]">{copy.loading}</p>
      </main>
    );
  }

  if (state.kind === 'failure') {
    if (state.branch === 'no_account') return <NoAccountFailure />;
    if (state.branch === 'no_link') return <NoLinkFailure />;
    if (state.branch === 'offline') return <OfflineFailure onRetry={() => void handleRetry()} />;
  }

  if (state.kind === 'role_not_admin') return <NotAdminFailure />;

  return (
    <main className="grid min-h-dvh place-items-center px-6">
      <form
        className="w-full max-w-sm space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          setErrorKey(null);
          setBusy(true);
          const db = await openLocalDb();
          try {
            const { session, mk, serverOutcome } = await loginOnlineLinked({
              db,
              serverClient: httpServerClient,
              passphrase,
            });
            useSessionStore.getState().setSession(session, mk);
            switch (serverOutcome.kind) {
              case 'ok':
                useConnectivityStore.getState().onServerOk();
                break;
              case 'unreachable':
                useConnectivityStore.getState().onServerUnreachable();
                setErrorKey('serverUnreachable');
                return;
              case 'auth_failed':
                useConnectivityStore.getState().onServerAuthFailed();
                setErrorKey('authFailed');
                return;
              case 'skipped':
                // Spec §6.2 step 3 already blocks unlinked accounts pre-login,
                // so this should not occur in practice; surface it generically.
                setErrorKey('genericError');
                return;
            }
            // Only reach here on serverOutcome.kind === 'ok'. The session now
            // has a real accessToken and the server-verified role.
            const role = session.role ?? 'user';
            if (classifyPostLogin(role) === 'admin_ok') {
              navigate('/dashboard', { replace: true });
            } else {
              setState({ kind: 'role_not_admin' });
            }
          } catch (err) {
            setErrorKey(mapLoginErrorToCopyKey(err) as ErrorCopyKey);
          } finally {
            db.close();
            setBusy(false);
          }
        }}
      >
        <h1 className="text-2xl font-medium">{copy.login.title}</h1>
        <label className="block">
          <span className="text-sm text-[var(--color-subtext-0)]">
            {copy.login.passphraseLabel}
          </span>
          <input
            type="password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            autoComplete="current-password"
            className="mt-1 w-full rounded-md border border-[var(--color-overlay-0)] bg-[var(--color-mantle)] px-3 py-2"
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-md bg-[var(--color-mauve)] px-4 py-2 text-[var(--color-base)] disabled:opacity-50"
        >
          {copy.login.submit}
        </button>
        {errorKey !== null && copy.login.errors[errorKey] !== '' && (
          <p className="text-sm text-[var(--color-red)]">{copy.login.errors[errorKey]}</p>
        )}
      </form>
    </main>
  );
}
