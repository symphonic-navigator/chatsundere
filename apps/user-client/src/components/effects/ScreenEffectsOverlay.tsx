// SPDX-License-Identifier: AGPL-3.0-only
import type { EmojiShowerEffect as EmojiShowerPayload } from '@chatsundere/llm-unified';
import type { JSX } from 'react';
import { useScreenEffectsStore } from '../../lib/integrations/screen-effects-store.js';
import { EmojiShowerEffect } from './EmojiShowerEffect.js';

/**
 * Global, full-viewport, pointer-events-none overlay that plays every queued
 * screen effect over the whole screen. Mounted once in the app shell; each
 * active effect renders its renderer and removes itself via `onDone`.
 */
export function ScreenEffectsOverlay(): JSX.Element | null {
  const active = useScreenEffectsStore((s) => s.active);
  const remove = useScreenEffectsStore((s) => s.remove);

  if (active.length === 0) return null;

  return (
    <div className="sfx-overlay" aria-hidden="true">
      {active.map((a) => {
        if (a.effect.kind !== 'emoji-shower') return null;
        const payload = a.effect as EmojiShowerPayload;
        return (
          <EmojiShowerEffect
            key={a.id}
            emoji={payload.emoji}
            reducedMotion={a.reducedMotion}
            onDone={() => remove(a.id)}
          />
        );
      })}
    </div>
  );
}
