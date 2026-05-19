// SPDX-License-Identifier: AGPL-3.0-only
import { Link } from 'react-router-dom';
import { copy } from '../lib/copy.js';

/** Entry point for unauthenticated users with no local account. */
export function Onboarding() {
  const c = copy.onboarding;

  return (
    <div className="mt-8 space-y-6">
      <div className="space-y-1">
        <h1 className="font-display text-4xl italic lg:text-5xl">{c.title}</h1>
        <p className="text-sm text-paper-soft">{c.body}</p>
      </div>

      {/* Create new account — primary action */}
      <div className="rounded-[var(--radius-card)] bg-ink-soft p-6 ring-1 ring-inset ring-aurora-700/40 space-y-4">
        <div className="space-y-1">
          <h2 className="font-display text-2xl italic">{c.createHeading}</h2>
          <p className="text-sm text-paper-soft">{c.createBody}</p>
        </div>
        <Link
          to="/create"
          className="block w-full rounded-[var(--radius-card)] bg-aurora-500 px-6 py-3 text-center font-mono text-sm uppercase tracking-wider text-paper hover:bg-aurora-200 hover:text-ink"
        >
          {c.createCta}
        </Link>
      </div>

      {/* Load existing account — disabled, per CLAUDE.md §11 disabled-over-hidden */}
      <div
        className="rounded-[var(--radius-card)] bg-ink-soft/40 p-6 ring-1 ring-inset ring-aurora-700/20 space-y-4 opacity-50"
        aria-disabled="true"
      >
        <div className="space-y-1">
          <h2 className="font-display text-2xl italic text-paper-soft">{c.loadHeading}</h2>
          <p className="text-sm text-paper-soft">{c.loadBody}</p>
        </div>
        <button
          type="button"
          disabled
          aria-disabled="true"
          title={c.loadDisabledTooltip}
          className="w-full cursor-not-allowed rounded-[var(--radius-card)] bg-ink-soft px-6 py-3 font-mono text-sm uppercase tracking-wider text-paper-soft ring-1 ring-inset ring-aurora-700/20"
        >
          {c.loadCta}
        </button>
      </div>
    </div>
  );
}
