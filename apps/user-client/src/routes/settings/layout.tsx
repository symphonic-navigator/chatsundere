// SPDX-License-Identifier: AGPL-3.0-only

import { NavLink, Outlet } from 'react-router-dom';
import { copy } from '../../lib/copy.js';

const tabs = [
  { to: '/settings/account', label: copy.settings.nav.account },
  { to: '/settings/auth-methods', label: copy.settings.nav.authMethods },
  { to: '/settings/server-linking', label: copy.settings.nav.serverLinking },
  { to: '/settings/about', label: copy.settings.nav.about },
] as const;

/**
 * Responsive settings container.
 *
 * Mobile (< lg): horizontal scrollable tab bar at the top, content below.
 * Desktop (≥ lg): vertical tab nav on the left, content on the right.
 */
export function SettingsLayout() {
  return (
    <div className="mt-8 lg:flex lg:gap-8">
      {/* Side nav — desktop */}
      <nav
        aria-label="Settings navigation"
        className="hidden shrink-0 flex-col gap-1 lg:flex lg:w-44"
      >
        {tabs.map(({ to, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              [
                'rounded-[var(--radius-pill)] px-3 py-2 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-aurora-700/30 text-aurora-200'
                  : 'text-paper-soft hover:bg-ink-soft hover:text-paper',
              ].join(' ')
            }
          >
            {label}
          </NavLink>
        ))}
      </nav>

      {/* Top tab bar — mobile */}
      <nav aria-label="Settings navigation" className="mb-6 flex overflow-x-auto lg:hidden">
        <div className="flex gap-1 border-b border-aurora-700/20 pb-px">
          {tabs.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) =>
                [
                  'shrink-0 whitespace-nowrap px-4 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'border-b-2 border-aurora-500 text-aurora-200'
                    : 'text-paper-soft hover:text-paper',
                ].join(' ')
              }
            >
              {label}
            </NavLink>
          ))}
        </div>
      </nav>

      {/* Tab content */}
      <div className="min-w-0 flex-1">
        <Outlet />
      </div>
    </div>
  );
}
