// SPDX-License-Identifier: AGPL-3.0-only

import { useNavigate } from 'react-router-dom';
import { useAdultMode } from '../data/settings.js';
import { nsfwPanic } from '../lib/nsfw-panic.js';
import { useCurrentChatStore } from '../state/current-chat.store.js';

/**
 * Brand-bar pill toggling the global adult-mode filter.
 *
 * Single-state pill: shows the active mode + ⇄ glyph for discoverability.
 * Click toggles. NSFW = red-toned (matches PersonaCard NSFW glow);
 * SFW = grey-toned (matches PersonaCard SFW glow). The pill itself
 * shimmers subtly via CSS (.adult-mode-toggle::before in index.css);
 * prefers-reduced-motion disables the shimmer.
 *
 * On the nsfw → sfw transition, nsfwPanic() runs first (Phase-3.2):
 * any in-flight streams against adult personas are aborted (discard
 * semantics) and the user is navigated away if they are in such a chat.
 *
 * Hidden entirely while in a chat with a SFW persona (`chatPersonaIsAdult`
 * === false), published by chat-page — the toggle is irrelevant there and
 * its absence keeps the chat screen calmer. It stays visible everywhere else
 * and for adult-persona chats, where the mode indicator is still wanted.
 */
export function AdultModeToggle(): JSX.Element | null {
  const { mode, toggleMode } = useAdultMode();
  const navigate = useNavigate();
  const chatPersonaIsAdult = useCurrentChatStore((s) => s.chatPersonaIsAdult);
  const isNsfw = mode === 'nsfw';

  if (chatPersonaIsAdult === false) return null;

  async function handleToggle() {
    if (mode === 'nsfw') {
      await nsfwPanic({ navigate });
    }
    await toggleMode();
  }

  return (
    <button
      type="button"
      onClick={() => void handleToggle()}
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
