// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useOnboardingStore } from '../../state/onboarding.store.js';

interface Cell {
  to: string;
  label: string;
  hint: string;
}

const CELLS: readonly Cell[] = [
  {
    to: '/onboarding/invitation',
    label: 'I have an invitation',
    hint: 'From your operator',
  },
  {
    to: '/onboarding/pairing',
    label: 'Add this device',
    hint: "I'm already a user",
  },
  {
    to: '/onboarding/recovery',
    label: 'Use a recovery key',
    hint: 'I lost my devices',
  },
  {
    to: '/onboarding/local',
    label: 'Just this device',
    hint: 'No server, no sync',
  },
] as const;

/**
 * 2×2 fullscreen intent matrix. Entry surface when no local session exists.
 * Per spec § 2 Decision 2: sorted by intent. All four cells are live now that
 * the server-connection paths land in Block 2 — the "Disabled over Hidden"
 * gating that greyed out three cells in Block 1 no longer applies here.
 */
export function OnboardingMatrix() {
  // Clear any stale store state from a previous interrupted attempt.
  useEffect(() => useOnboardingStore.getState().reset(), []);

  return (
    <main className="grid min-h-dvh grid-cols-2 gap-px bg-aurora-700/20">
      {CELLS.map((cell) => (
        <ActiveCell key={cell.to} cell={cell} />
      ))}
    </main>
  );
}

function ActiveCell({ cell }: { cell: Cell }) {
  return (
    <Link
      to={cell.to}
      className="flex flex-col items-center justify-center bg-ink-soft px-4 py-6 text-center"
    >
      <div className="mb-2 h-10 w-10 rounded bg-aurora-700/20" aria-hidden />
      <h2 className="font-display text-lg italic">{cell.label}</h2>
      <p className="mt-1 text-xs text-paper-soft">{cell.hint}</p>
    </Link>
  );
}
