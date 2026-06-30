// SPDX-License-Identifier: AGPL-3.0-only
import { findIntegrationTags, getIntegration } from '@chatsundere/llm-unified';
import { useEffect, useRef } from 'react';
import { useScreenEffectsStore } from './screen-effects-store.js';

/** Minimal segment shape this hook needs; the real SpeechSegment satisfies it. */
interface ReadAloudSegment {
  segmentId: string;
  charRange: readonly [number, number];
}

/**
 * Assign every integration tag in `rawText` to exactly one segment, then return
 * the tags owned by `currentSegmentId` in document order.
 *
 * A tag-only paragraph (e.g. `[sfx:emoji-shower 🎉]` on its own line) is stripped
 * to empty spoken text and so emits NO speakable segment — leaving its tag with
 * no char-range to fall inside. Without this, such a tag's effect never fires
 * during read-aloud. Ownership rule: a tag inside a segment's range belongs to
 * that segment (prior behaviour); a tag in a gap between segments belongs to the
 * next segment in document order; a trailing tag (after the last segment)
 * belongs to the last segment. Each tag thus fires exactly once per playback.
 */
export function tagsForSegment(
  rawText: string,
  segments: readonly ReadAloudSegment[],
  currentSegmentId: string,
): ReturnType<typeof findIntegrationTags> {
  if (segments.length === 0) return [];
  const ordered = [...segments].sort(
    (a, b) => a.charRange[0] - b.charRange[0] || a.charRange[1] - b.charRange[1],
  );
  const last = ordered[ordered.length - 1];
  if (last === undefined) return [];

  const ownerOf = (index: number): string => {
    for (const seg of ordered) {
      if (index >= seg.charRange[0] && index < seg.charRange[1]) return seg.segmentId;
    }
    for (const seg of ordered) {
      if (seg.charRange[0] > index) return seg.segmentId;
    }
    return last.segmentId;
  };

  return findIntegrationTags(rawText).filter((tag) => ownerOf(tag.index) === currentSegmentId);
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

    for (const tag of tagsForSegment(rawText, segments, currentSegmentId)) {
      const effect = getIntegration(tag.prefix)?.handle(tag.command, tag.rawArgs)?.effect;
      if (effect) trigger(effect);
    }
  }, [messageId, rawText, segments, currentSegmentId, currentMessageId, enabled, trigger]);
}
