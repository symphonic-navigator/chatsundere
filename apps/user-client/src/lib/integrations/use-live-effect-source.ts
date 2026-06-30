// SPDX-License-Identifier: AGPL-3.0-only
import { findIntegrationTags, getIntegration } from '@chatsundere/llm-unified';
import { useEffect, useRef } from 'react';
import { useScreenEffectsStore } from './screen-effects-store.js';

/**
 * Live-stream effect trigger. As the streaming draft grows, dispatches the
 * effect for each integration tag whose closing `]` has arrived — once per tag,
 * deduped by its start index within this draft. The seen-set resets when the
 * draft clears (`null`), so the next message replays. Gated by `enabled`: when
 * off, no effect is dispatched (the inline glow still renders elsewhere).
 */
export function useLiveEffectSource(draftText: string | null, enabled: boolean): void {
  const trigger = useScreenEffectsStore((s) => s.trigger);
  const seen = useRef<Set<number>>(new Set());

  useEffect(() => {
    // A cleared draft means the message finalised — reset for the next one.
    if (draftText === null) {
      seen.current = new Set();
      return;
    }
    if (!enabled || draftText.length === 0) return;

    for (const tag of findIntegrationTags(draftText)) {
      if (seen.current.has(tag.index)) continue;
      seen.current.add(tag.index);
      const effect = getIntegration(tag.prefix)?.handle(tag.command, tag.rawArgs)?.effect;
      if (effect) trigger(effect);
    }
  }, [draftText, enabled, trigger]);
}
