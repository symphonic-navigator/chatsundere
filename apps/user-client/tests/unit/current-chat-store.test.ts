import { beforeEach, describe, expect, it } from 'vitest';
import { useCurrentChatStore } from '../../src/state/current-chat.store';

describe('useCurrentChatStore', () => {
  beforeEach(() => useCurrentChatStore.getState().reset());

  it('initial state defaults are sane', () => {
    const s = useCurrentChatStore.getState();
    expect(s.chatId).toBeNull();
    expect(s.expandedMessageId).toBeNull();
    expect(s.autoFollowEnabled).toBe(true);
    expect(s.isInteractionMode).toBe(false);
    expect(s.isPinned).toBe(false);
  });

  it('setChatId(non-null) also clears pendingPersonaId', () => {
    useCurrentChatStore.getState().setLazy('persona-1');
    expect(useCurrentChatStore.getState().pendingPersonaId).toBe('persona-1');
    useCurrentChatStore.getState().setChatId('chat-1');
    expect(useCurrentChatStore.getState().chatId).toBe('chat-1');
    expect(useCurrentChatStore.getState().pendingPersonaId).toBeNull();
  });

  it('expansion exclusivity', () => {
    useCurrentChatStore.getState().toggleExpanded('m1');
    expect(useCurrentChatStore.getState().expandedMessageId).toBe('m1');
    useCurrentChatStore.getState().toggleExpanded('m2');
    expect(useCurrentChatStore.getState().expandedMessageId).toBe('m2');
    useCurrentChatStore.getState().toggleExpanded('m2');
    expect(useCurrentChatStore.getState().expandedMessageId).toBeNull();
  });

  it('reset returns everything to initial', () => {
    const s = useCurrentChatStore.getState();
    s.setChatId('chat-1');
    s.toggleExpanded('m1');
    s.setInteractionMode(true);
    s.togglePin();
    s.setAutoFollow(false);
    s.setReasoning({ kind: 'off' });
    s.reset();
    const after = useCurrentChatStore.getState();
    expect(after.chatId).toBeNull();
    expect(after.expandedMessageId).toBeNull();
    expect(after.isInteractionMode).toBe(false);
    expect(after.isPinned).toBe(false);
    expect(after.autoFollowEnabled).toBe(true);
    expect(after.reasoning).toEqual({ kind: 'off' });
  });
});
