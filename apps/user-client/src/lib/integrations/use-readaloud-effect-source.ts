// SPDX-License-Identifier: AGPL-3.0-only
import { findIntegrationTags, getIntegration } from '@chatsundere/llm-unified';
import { useEffect, useRef } from 'react';
import { useScreenEffectsStore } from './screen-effects-store.js';

/** Minimal segment shape this hook needs; the real SpeechSegment satisfies it. */
interface ReadAloudSegment {
  segmentId: string;
  charRange: readonly [number, number];
}

interface UseReadAloudEffectSourceArgs {
  messageId: string;
  rawText: string;
  segments: readonly ReadAloudSegment[];
  currentSegmentId: string | null;
  currentMessageId: string | null;
  enabled: boolean;
}

/**
 * Read-aloud effect replay. While this message is the one being read aloud,
 * dispatches the effect for any integration tag whose start index falls inside
 * the currently-spoken segment's char range — once per segment visit. The
 * seen-set resets when playback ends (`currentMessageId` clears) so a second
 * read replays. Gated by `enabled`.
 */
export function useReadAloudEffectSource({
  messageId,
  rawText,
  segments,
  currentSegmentId,
  currentMessageId,
  enabled,
}: UseReadAloudEffectSourceArgs): void {
  const trigger = useScreenEffectsStore((s) => s.trigger);
  const seen = useRef<Set<string>>(new Set());

  useEffect(() => {
    // Playback ended — reset so a later replay of any message fires afresh.
    if (currentMessageId === null) {
      seen.current = new Set();
      return;
    }
    if (!enabled || currentMessageId !== messageId || currentSegmentId === null) return;
    if (seen.current.has(currentSegmentId)) return;

    const seg = segments.find((s) => s.segmentId === currentSegmentId);
    if (seg === undefined) return;
    seen.current.add(currentSegmentId);

    const [start, end] = seg.charRange;
    for (const tag of findIntegrationTags(rawText)) {
      if (tag.index < start || tag.index >= end) continue;
      const effect = getIntegration(tag.prefix)?.handle(tag.command, tag.rawArgs)?.effect;
      if (effect) trigger(effect);
    }
  }, [messageId, rawText, segments, currentSegmentId, currentMessageId, enabled, trigger]);
}
