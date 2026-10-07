// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it } from 'vitest';
import { useCurrentChatStore } from '../../src/state/current-chat.store.js';

describe('current-chat store — quick menu', () => {
  beforeEach(() => useCurrentChatStore.getState().reset());

  it('starts closed, opens with an anchor, closes again', () => {
    expect(useCurrentChatStore.getState().quickMenuAnchor).toBeNull();
    useCurrentChatStore.getState().openQuickMenu({ top: 1, left: 2, bottom: 3 });
    expect(useCurrentChatStore.getState().quickMenuAnchor).toEqual({ top: 1, left: 2, bottom: 3 });
    useCurrentChatStore.getState().closeQuickMenu();
    expect(useCurrentChatStore.getState().quickMenuAnchor).toBeNull();
  });

  it('reset closes it', () => {
    useCurrentChatStore.getState().openQuickMenu({ top: 1, left: 2, bottom: 3 });
    useCurrentChatStore.getState().reset();
    expect(useCurrentChatStore.getState().quickMenuAnchor).toBeNull();
  });
});
