import { beforeEach, describe, expect, it } from 'vitest';
import { useCurrentChatStore } from '../../src/state/current-chat.store.js';

beforeEach(() => useCurrentChatStore.getState().reset());

describe('web-search tier-id slice', () => {
  it('defaults to null', () => {
    expect(useCurrentChatStore.getState().webSearchTierId).toBeNull();
  });

  it('setWebSearchTierId updates the value', () => {
    useCurrentChatStore.getState().setWebSearchTierId('neural');
    expect(useCurrentChatStore.getState().webSearchTierId).toBe('neural');
  });

  it('setWebSearchTierId accepts null to clear', () => {
    useCurrentChatStore.getState().setWebSearchTierId('neural');
    useCurrentChatStore.getState().setWebSearchTierId(null);
    expect(useCurrentChatStore.getState().webSearchTierId).toBeNull();
  });

  it('reset clears webSearchTierId back to null', () => {
    useCurrentChatStore.getState().setWebSearchTierId('neural');
    useCurrentChatStore.getState().reset();
    expect(useCurrentChatStore.getState().webSearchTierId).toBeNull();
  });
});
