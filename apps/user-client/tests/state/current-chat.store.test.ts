import { beforeEach, describe, expect, it } from 'vitest';
import { useCurrentChatStore } from '../../src/state/current-chat.store.js';

beforeEach(() => useCurrentChatStore.getState().reset());

describe('reading tool-strip state', () => {
  it('starts collapsed and unpinned', () => {
    const s = useCurrentChatStore.getState();
    expect(s.isToolStripExpanded).toBe(false);
    expect(s.isToolStripPinned).toBe(false);
  });

  it('setToolStripExpanded toggles expansion', () => {
    useCurrentChatStore.getState().setToolStripExpanded(true);
    expect(useCurrentChatStore.getState().isToolStripExpanded).toBe(true);
  });

  it('collapseToolStripIfUnpinned collapses when not pinned', () => {
    useCurrentChatStore.getState().setToolStripExpanded(true);
    useCurrentChatStore.getState().collapseToolStripIfUnpinned();
    expect(useCurrentChatStore.getState().isToolStripExpanded).toBe(false);
  });

  it('collapseToolStripIfUnpinned is a no-op when pinned', () => {
    useCurrentChatStore.getState().setToolStripExpanded(true);
    useCurrentChatStore.getState().toggleToolStripPin(); // → pinned
    useCurrentChatStore.getState().collapseToolStripIfUnpinned();
    expect(useCurrentChatStore.getState().isToolStripExpanded).toBe(true);
  });

  it('reset clears tool-strip state', () => {
    useCurrentChatStore.getState().setToolStripExpanded(true);
    useCurrentChatStore.getState().toggleToolStripPin();
    useCurrentChatStore.getState().reset();
    const s = useCurrentChatStore.getState();
    expect(s.isToolStripExpanded).toBe(false);
    expect(s.isToolStripPinned).toBe(false);
  });
});
