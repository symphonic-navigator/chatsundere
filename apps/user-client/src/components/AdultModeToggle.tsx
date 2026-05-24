// SPDX-License-Identifier: AGPL-3.0-only

import { useAdultMode } from '../data/settings.js';

/**
 * Brand-bar pill toggling the global adult-mode filter.
 *
 * Single-state pill: shows the active mode + ⇄ glyph for discoverability.
 * Click toggles. NSFW = red-toned (matches PersonaCard NSFW glow);
 * SFW = grey-toned (matches PersonaCard SFW glow). The pill itself
 * shimmers subtly via CSS (.adult-mode-toggle::before in index.css);
 * prefers-reduced-motion disables the shimmer.
 */
export function AdultModeToggle(): JSX.Element {
  const { mode, toggleMode } = useAdultMode();
  const isNsfw = mode === 'nsfw';
  return (
    <button
      type="button"
      onClick={() => void toggleMode()}
      aria-label={`Adult mode: ${mode.toUpperCase()}. Tap to switch.`}
      className={`adult-mode-toggle ${
        isNsfw ? 'adult-mode-toggle-nsfw' : 'adult-mode-toggle-sfw'
      } inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 font-mono text-[0.7rem] uppercase tracking-wider`}
    >
      {mode.toUpperCase()}
      <span aria-hidden="true" className="opacity-60">
        ⇄
      </span>
    </button>
  );
}
