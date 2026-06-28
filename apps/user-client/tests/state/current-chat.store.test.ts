import { beforeEach, describe, expect, it } from 'vitest';
import { useCurrentChatStore } from '../../src/state/current-chat.store.js';

beforeEach(() => useCurrentChatStore.getState().reset());

describe('chatHeader', () => {
  it('defaults to null', () => {
    expect(useCurrentChatStore.getState().chatHeader).toBeNull();
  });

  it('setChatHeader publishes persona + title and reset clears it', () => {
    useCurrentChatStore.getState().setChatHeader({
      personaId: 'p1',
      name: 'Laura',
      colour: '#c44e8e',
      title: 'Evening at the harbour',
    });
    expect(useCurrentChatStore.getState().chatHeader?.name).toBe('Laura');
    useCurrentChatStore.getState().reset();
    expect(useCurrentChatStore.getState().chatHeader).toBeNull();
  });
});

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
