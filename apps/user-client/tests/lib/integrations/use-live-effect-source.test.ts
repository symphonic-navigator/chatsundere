// SPDX-License-Identifier: AGPL-3.0-only
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useScreenEffectsStore } from '../../../src/lib/integrations/screen-effects-store.js';
import { useLiveEffectSource } from '../../../src/lib/integrations/use-live-effect-source.js';

describe('useLiveEffectSource', () => {
  beforeEach(() => useScreenEffectsStore.setState({ active: [] }));

  it('dispatches once when a tag completes in the growing draft', () => {
    const { rerender } = renderHook(({ t }) => useLiveEffectSource(t, true), {
      initialProps: { t: 'hi [sfx:emoji-shower 🔥' }, // incomplete
    });
    expect(useScreenEffectsStore.getState().active).toHaveLength(0);
    rerender({ t: 'hi [sfx:emoji-shower 🔥]' }); // now complete
    expect(useScreenEffectsStore.getState().active).toHaveLength(1);
    rerender({ t: 'hi [sfx:emoji-shower 🔥] more' }); // unchanged tag, no re-dispatch
    expect(useScreenEffectsStore.getState().active).toHaveLength(1);
  });

  it('does not dispatch when disabled', () => {
    renderHook(() => useLiveEffectSource('[sfx:emoji-shower 💖]', false));
    expect(useScreenEffectsStore.getState().active).toHaveLength(0);
  });
});
