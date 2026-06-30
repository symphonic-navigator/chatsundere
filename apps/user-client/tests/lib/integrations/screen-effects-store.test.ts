// SPDX-License-Identifier: AGPL-3.0-only
import type { EmojiShowerEffect } from '@chatsundere/llm-unified';
import { beforeEach, describe, expect, it } from 'vitest';
import { useScreenEffectsStore } from '../../../src/lib/integrations/screen-effects-store.js';

const shower = (emoji: string[]): EmojiShowerEffect => ({ kind: 'emoji-shower', emoji });

describe('screen-effects store', () => {
  beforeEach(() => useScreenEffectsStore.setState({ active: [] }));

  it('enqueues a triggered effect with a unique id', () => {
    useScreenEffectsStore.getState().trigger(shower(['🔥']));
    const { active } = useScreenEffectsStore.getState();
    expect(active).toHaveLength(1);
    expect(active[0]?.effect).toEqual({ kind: 'emoji-shower', emoji: ['🔥'] });
    expect(active[0]?.id).toMatch(/^fx-\d+$/);
  });

  it('removes a finished effect by id', () => {
    const s = useScreenEffectsStore.getState();
    s.trigger(shower(['💖']));
    const id = useScreenEffectsStore.getState().active[0]?.id ?? '';
    useScreenEffectsStore.getState().remove(id);
    expect(useScreenEffectsStore.getState().active).toHaveLength(0);
  });
});
