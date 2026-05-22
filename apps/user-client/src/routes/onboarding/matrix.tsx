// SPDX-License-Identifier: AGPL-3.0-only
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useOnboardingStore } from '../../state/onboarding.store.js';

const CELLS = [
  { to: '/onboarding/invitation', label: 'I have an invitation', hint: 'From your operator' },
  { to: '/onboarding/pairing', label: 'Add this device', hint: "I'm already a user" },
  { to: '/onboarding/recovery', label: 'Use a recovery key', hint: 'I lost my devices' },
  { to: '/onboarding/local', label: 'Just this device', hint: 'No server, no sync' },
] as const;

/**
 * 2×2 fullscreen intent matrix. Entry surface when no local session exists.
 * Per spec § 2 Decision 2: sorted by intent (not by input modality). Each cell
 * has an icon slot left blank for the styling pass to fill.
 *
 * Styling is deliberately minimal per [[feedback_mechanics_first_styling_later]];
 * the styling pass adds icons, colours, breathing-orbs aesthetic etc.
 */
export function OnboardingMatrix() {
  // Clear any stale store state from a previous interrupted attempt.
  useEffect(() => useOnboardingStore.getState().reset(), []);

  return (
    <main className="grid min-h-dvh grid-cols-2 gap-px bg-aurora-700/20">
      {CELLS.map((cell) => (
        <Link
          key={cell.to}
          to={cell.to}
          className="flex flex-col items-center justify-center bg-ink-soft px-4 py-6 text-center"
        >
          {/* Icon slot — styling pass adds the symbol. */}
          <div className="mb-2 h-10 w-10 rounded bg-aurora-700/20" aria-hidden />
          <h2 className="font-display text-lg italic">{cell.label}</h2>
          <p className="mt-1 text-xs text-paper-soft">{cell.hint}</p>
        </Link>
      ))}
    </main>
  );
}
