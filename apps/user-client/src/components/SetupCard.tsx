// SPDX-License-Identifier: AGPL-3.0-only
import { Sparkles } from 'lucide-react';
import { useNavZoom } from '../lib/use-nav-zoom.js';

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
