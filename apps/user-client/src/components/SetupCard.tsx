// SPDX-License-Identifier: AGPL-3.0-only
import { CloudDownload, Sparkles } from 'lucide-react';
import { useNavZoom } from '../lib/use-nav-zoom.js';
import { syncCopy } from '../sync/copy.js';

export interface SetupStep {
  label: string;
  to: string;
}

/**
 * The first-run Crown card (spec §5): when a hard blocker is missing, this
 * replaces the Continue card and wears the gold priority overlay. Lists only
 * the unsatisfied steps; each is a real focusable button navigating to its
 * fix. "Omakase, not nagging" — the optional Global Unlocker is deliberately
 * not a step here. Reuses the NavTile shell visually (data-static = no tap on
 * the container itself; the steps carry the actions).
 */
export function SetupCard({ steps }: { steps: SetupStep[] }): JSX.Element {
  const activate = useNavZoom();
  return (
    <div
      className="cs-navtile"
      data-colour="pink"
      data-gold="true"
      data-wide="true"
      data-static="true"
    >
      <Sparkles className="cs-navtile-icon" size={22} aria-hidden="true" />
      <span className="text-[10px] uppercase tracking-widest text-paper-soft">
        Let's get you set up
      </span>
      <div className="mt-1 flex flex-col gap-1">
        {steps.map((s) => (
          <button
            key={s.to}
            type="button"
            className="cs-setup-step"
            onClick={(e) => activate(e.currentTarget, s.to)}
          >
            → {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * The Crown card while the first post-link sync is still running (pre-test
 * analysis #9): a freshly recovered/paired device has an empty vault for a few
 * moments, and showing the SetupCard's "Create your first companion" there is
 * active misdirection — a user could create a duplicate persona while their
 * real one is already on its way. Calm and non-interactive, deliberately NOT
 * gold: gold marks the one priority action, and here the only job is to wait.
 */
export function FirstSyncCard(): JSX.Element {
  return (
    <div
      className="cs-navtile"
      data-colour="pink"
      data-wide="true"
      data-static="true"
      aria-live="polite"
    >
      <CloudDownload className="cs-navtile-icon" size={22} aria-hidden="true" />
      <span className="cs-navtile-label">{syncCopy.firstSync.title}</span>
      <span className="mt-1 text-[11px] text-paper-soft">{syncCopy.firstSync.body}</span>
    </div>
  );
}
