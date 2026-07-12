// SPDX-License-Identifier: AGPL-3.0-only

import { CloudOff, KeyRound, MonitorSmartphone, Ticket } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useEffect } from 'react';
import { NavTile, type NavTileColour } from '../../components/ui/NavTile.js';
import { useOnboardingStore } from '../../state/onboarding.store.js';

interface Cell {
  to: string;
  label: string;
  hint: string;
  icon: LucideIcon;
  colour: NavTileColour;
  gold?: boolean;
}

// Sorted by intent (spec §2). The two account-backed paths — invitation and
// device-link — are the fully-featured outcome and share the gold priority
// overlay (a conscious two-gold deviation, spec §5). "Just this device" carries
// its lesser weight through hierarchy alone (purple, last), never through
// dimming — in this design language opacity means `disabled`.
const CELLS: readonly Cell[] = [
  {
    to: '/onboarding/invitation',
    label: 'I have an invitation',
    hint: 'From your operator',
    icon: Ticket,
    colour: 'pink',
    gold: true,
  },
  {
    to: '/onboarding/pairing',
    label: 'Link this device to my account',
    hint: "I'm already a user",
    icon: MonitorSmartphone,
    colour: 'pink',
    gold: true,
  },
  {
    to: '/onboarding/recovery',
    label: 'Use a recovery key',
    hint: 'I lost my devices',
    icon: KeyRound,
    colour: 'pink',
  },
  {
    to: '/onboarding/local',
    label: 'Just this device',
    hint: 'No server, no sync',
    icon: CloudOff,
    colour: 'purple',
  },
] as const;

/**
 * Intent screen — the entry surface when no local session exists: a "Welcome"
 * eyebrow over the Chatsundere wordmark, then four standard-height menu tiles
 * (same size as everywhere else), vertically centred so the spare space becomes
 * breathing room rather than tile height (spec
 * `2026-07-12-onboarding-matrix-makeover-design`).
 */
export function OnboardingMatrix() {
  // Clear any stale store state from a previous interrupted attempt.
  useEffect(() => useOnboardingStore.getState().reset(), []);

  return (
    <main className="flex min-h-dvh flex-col justify-center gap-3 px-4 py-6">
      <header className="mb-2 text-center">
        <div className="text-[10px] uppercase tracking-[0.3em] text-paper-soft">Welcome</div>
        <div className="relative mt-1 inline-flex items-baseline">
          <span className="brand-logo-text font-display text-4xl">Chatsundere</span>
          <span className="brand-logo-twinkle" aria-hidden="true" style={{ fontSize: '1.1rem' }}>
            ✦
          </span>
        </div>
      </header>

      {CELLS.map((cell) => (
        <NavTile
          key={cell.to}
          to={cell.to}
          label={cell.label}
          meta={cell.hint}
          icon={cell.icon}
          colour={cell.colour}
          gold={cell.gold}
        />
      ))}
    </main>
  );
}
