// SPDX-License-Identifier: AGPL-3.0-only
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useScreenEffectsStore } from '../../../src/lib/integrations/screen-effects-store.js';
import {
  tagsForSegment,
  useReadAloudEffectSource,
} from '../../../src/lib/integrations/use-readaloud-effect-source.js';

const raw = 'hello [sfx:emoji-shower 🔥] world';
const segments = [
  { segmentId: '0:0', charRange: [0, 27] as [number, number], blockIndex: 0 },
  { segmentId: '0:1', charRange: [27, raw.length] as [number, number], blockIndex: 0 },
];

describe('useReadAloudEffectSource', () => {
  beforeEach(() => useScreenEffectsStore.setState({ active: [] }));

  it('fires when the segment containing the tag becomes active', () => {
    const { rerender } = renderHook(
      ({ seg }) =>
        useReadAloudEffectSource({
          messageId: 'm1',
          rawText: raw,
          segments,
          currentSegmentId: seg,
          currentMessageId: 'm1',
          enabled: true,
        }),
      { initialProps: { seg: null as string | null } },
    );
    expect(useScreenEffectsStore.getState().active).toHaveLength(0);
    rerender({ seg: '0:0' }); // contains the tag at index 6
    expect(useScreenEffectsStore.getState().active).toHaveLength(1);
    rerender({ seg: '0:1' }); // no tag here
    expect(useScreenEffectsStore.getState().active).toHaveLength(1);
  });

  it('does nothing when disabled', () => {
    renderHook(() =>
      useReadAloudEffectSource({
        messageId: 'm1',
        rawText: raw,
        segments,
        currentSegmentId: '0:0',
        currentMessageId: 'm1',
        enabled: false,
      }),
    );
    expect(useScreenEffectsStore.getState().active).toHaveLength(0);
  });

  // A tag on its own line is stripped to empty spoken text → emits no segment.
  // The effect must still fire (regression: it was orphaned, device-found
  // 2026-06-30). The next spoken segment claims it.
  it('fires an own-paragraph tag when the next spoken segment becomes active', () => {
    const orphanRaw = 'Hello there.\n\n[sfx:emoji-shower 🔥]\n\nGoodbye now.';
    const goodbyeStart = orphanRaw.indexOf('Goodbye');
    const orphanSegments = [
      { segmentId: '0:0', charRange: [0, 'Hello there.'.length] as [number, number] },
      { segmentId: '0:1', charRange: [goodbyeStart, orphanRaw.length] as [number, number] },
    ];
    const { rerender } = renderHook(
      ({ seg }) =>
        useReadAloudEffectSource({
          messageId: 'm1',
          rawText: orphanRaw,
          segments: orphanSegments,
          currentSegmentId: seg,
          currentMessageId: 'm1',
          enabled: true,
        }),
      { initialProps: { seg: null as string | null } },
    );
    rerender({ seg: '0:0' }); // the gap-tag is NOT here
    expect(useScreenEffectsStore.getState().active).toHaveLength(0);
    rerender({ seg: '0:1' }); // the next segment claims it
    expect(useScreenEffectsStore.getState().active).toHaveLength(1);
  });
});

describe('tagsForSegment — ownership of orphaned tags', () => {
  const cmd = (
    text: string,
    segs: { segmentId: string; charRange: readonly [number, number] }[],
    id: string,
  ): string[] => tagsForSegment(text, segs, id).map((t) => t.command);

  it('claims a tag inline within a text segment (prior behaviour)', () => {
    const text = 'Hello [sfx:emoji-shower 🎉] there.';
    expect(cmd(text, [{ segmentId: '0:0', charRange: [0, text.length] }], '0:0')).toEqual([
      'emoji-shower',
    ]);
  });

  it('claims an own-paragraph tag for the next segment, not the previous one', () => {
    const text = 'Hello there.\n\n[sfx:emoji-shower 🎉]\n\nGoodbye now.';
    const goodbyeStart = text.indexOf('Goodbye');
    const segs = [
      { segmentId: '0:0', charRange: [0, 'Hello there.'.length] as [number, number] },
      { segmentId: '0:1', charRange: [goodbyeStart, text.length] as [number, number] },
    ];
    expect(cmd(text, segs, '0:1')).toEqual(['emoji-shower']);
    expect(cmd(text, segs, '0:0')).toEqual([]);
  });

  it('claims a trailing tag-only paragraph for the last segment', () => {
    const text = 'Hello there.\n\n[sfx:emoji-shower 🎉]';
    expect(cmd(text, [{ segmentId: '0:0', charRange: [0, 'Hello there.'.length] }], '0:0')).toEqual(
      ['emoji-shower'],
    );
  });

  it('claims a leading tag-only paragraph for the first segment', () => {
    const text = '[sfx:emoji-shower 🎉]\n\nHello there.';
    const helloStart = text.indexOf('Hello');
    expect(cmd(text, [{ segmentId: '0:0', charRange: [helloStart, text.length] }], '0:0')).toEqual([
      'emoji-shower',
    ]);
  });

  it('returns nothing when there are no segments to anchor on', () => {
    expect(tagsForSegment('[sfx:emoji-shower 🎉]', [], 'anything')).toEqual([]);
  });
});
