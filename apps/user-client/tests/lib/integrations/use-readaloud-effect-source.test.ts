// SPDX-License-Identifier: AGPL-3.0-only
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useScreenEffectsStore } from '../../../src/lib/integrations/screen-effects-store.js';
import { useReadAloudEffectSource } from '../../../src/lib/integrations/use-readaloud-effect-source.js';

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
});
