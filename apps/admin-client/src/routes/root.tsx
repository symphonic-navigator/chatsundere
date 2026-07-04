// SPDX-License-Identifier: AGPL-3.0-only
import { useSessionStore } from '@chatsundere/ui-shared';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { StepUpModalHost } from '../components/StepUpModalHost.js';
import { ConsoleChip, StatusLed } from '../components/console.js';
import { copy } from '../copy.js';

const NAV_TABS = [
  { to: '/dashboard', index: '01', label: copy.nav.dashboard },
  { to: '/users', index: '02', label: copy.nav.users },
  { to: '/invitations', index: '03', label: copy.nav.invitations },
  { to: '/audit', index: '04', label: copy.nav.audit },
];

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
      <StepUpModalHost />
      <header className="border-b border-[var(--color-surface-0)] bg-[var(--color-mantle)] px-4 py-3">
        <div className="mx-auto flex max-w-5xl items-center gap-3">
          <StatusLed tone="green" />
          <span className="text-sm font-bold tracking-[0.25em]">
            CHATSUNDERE <span className="text-[var(--color-overlay-0)]">{'//'}</span>{' '}
            <span className="text-[var(--color-mauve)]">ADMIN CONSOLE</span>
          </span>
          <div className="ml-auto flex items-center gap-2">
            <ConsoleChip tone="green">{copy.sysNominal}</ConsoleChip>
            {session?.username && session?.role && (
              <ConsoleChip>{`${session.username} · ${session.role}`}</ConsoleChip>
            )}
            {session?.userId && (
              <button
                type="button"
                onClick={signOut}
                className="rounded-md border border-[var(--color-surface-0)] bg-[var(--color-crust)] px-3 py-1 font-mono text-xs"
              >
                {copy.signOut}
              </button>
            )}
          </div>
        </div>
        <nav className="mx-auto mt-3 flex max-w-5xl gap-1 overflow-x-auto font-mono text-xs">
          {NAV_TABS.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              className={({ isActive }) =>
                isActive
                  ? 'rounded-t border border-b-2 border-[var(--color-surface-1)] border-b-[var(--color-mauve)] bg-[var(--color-crust)] px-3 py-1.5'
                  : 'border-b border-[var(--color-surface-0)] px-3 py-1.5 text-[var(--color-overlay-0)]'
              }
            >
              {tab.index} {tab.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
