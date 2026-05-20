// SPDX-License-Identifier: AGPL-3.0-only
import { useSessionStore } from '@chatsundere/ui-shared';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { copy } from '../copy.js';

export function RootLayout() {
  const session = useSessionStore((s) => s.session);
  const closeAndForget = useSessionStore((s) => s.closeAndForget);
  const navigate = useNavigate();

  const signOut = () => {
    closeAndForget();
    navigate('/login', { replace: true });
  };

  return (
    <div className="min-h-dvh">
      <header className="flex items-center justify-between border-b border-[var(--color-overlay-0)] bg-[var(--color-mantle)] px-4 py-3">
        <div className="flex items-center gap-6">
          <span className="text-lg">{copy.appName}</span>
          <nav className="flex gap-4 text-sm">
            <NavLink to="/dashboard" className={({ isActive }) => (isActive ? 'underline' : '')}>
              {copy.nav.dashboard}
            </NavLink>
            <NavLink to="/users" className={({ isActive }) => (isActive ? 'underline' : '')}>
              {copy.nav.users}
            </NavLink>
            <NavLink to="/invitations" className={({ isActive }) => (isActive ? 'underline' : '')}>
              {copy.nav.invitations}
            </NavLink>
            <NavLink to="/audit" className={({ isActive }) => (isActive ? 'underline' : '')}>
              {copy.nav.audit}
            </NavLink>
          </nav>
        </div>
        <div className="flex items-center gap-3 text-sm">
          {session?.userId && (
            <>
              <span className="text-[var(--color-subtext-0)]">{session.userId.slice(0, 8)}…</span>
              <button
                type="button"
                onClick={signOut}
                className="rounded-md bg-[var(--color-base)] px-3 py-1"
              >
                {copy.signOut}
              </button>
            </>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
