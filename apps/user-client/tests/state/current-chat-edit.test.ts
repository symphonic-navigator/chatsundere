// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it } from 'vitest';
import { useCurrentChatStore } from '../../src/state/current-chat.store.js';

beforeEach(() => useCurrentChatStore.getState().resetEditSession());

describe('current-chat edit session', () => {
  it('stages and unstages attachment removals', () => {
    const s = () => useCurrentChatStore.getState();
    s().stageRemoval('a1');
    s().stageRemoval('a2');
    expect(s().editStagedRemovals).toEqual(['a1', 'a2']);
    s().unstageRemoval('a1');
    expect(s().editStagedRemovals).toEqual(['a2']);
    s().resetEditSession();
    expect(s().editStagedRemovals).toEqual([]);
  });
});
