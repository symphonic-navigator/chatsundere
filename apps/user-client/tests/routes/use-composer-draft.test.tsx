// SPDX-License-Identifier: AGPL-3.0-only
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DRAFT_DEBOUNCE_MS,
  useComposerDraft,
} from '../../src/routes/app/chat/use-composer-draft.js';

type Row = { id: string; draftInput: string } | null | undefined;

function setup(initial: { activeChatId: string; chatRow: Row }) {
  const persist = vi.fn();
  const hook = renderHook(
    ({ activeChatId, chatRow }: { activeChatId: string; chatRow: Row }) =>
      useComposerDraft({
        isLazy: false,
        personaId: null,
        activeChatId,
        chatRow,
        persist,
        skipLazySave: () => false,
      }),
    { initialProps: initial },
  );
  const type = (text: string) => act(() => hook.result.current[1](text));
  const tick = (ms = DRAFT_DEBOUNCE_MS) => act(() => vi.advanceTimersByTime(ms));
  return { hook, persist, type, tick };
}

describe('useComposerDraft (chat mode)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('hydrates the draft from the chat row once it loads', () => {
    const { hook } = setup({ activeChatId: 'a', chatRow: undefined });
    expect(hook.result.current[0]).toBe('');
    hook.rerender({ activeChatId: 'a', chatRow: { id: 'a', draftInput: 'saved' } });
    expect(hook.result.current[0]).toBe('saved');
  });

  it('persists the draft after the debounce', () => {
    const { persist, type, tick } = setup({
      activeChatId: 'a',
      chatRow: { id: 'a', draftInput: '' },
    });
    type('hello');
    expect(persist).not.toHaveBeenCalled();
    tick();
    expect(persist).toHaveBeenCalledWith('a', 'hello');
  });

  // The field bug: text typed while a save round-trips was overwritten by the
  // stale saved value echoing back through the refetched chat row.
  it('does not overwrite text typed while a save round-trips', () => {
    const { hook, type, tick } = setup({
      activeChatId: 'a',
      chatRow: { id: 'a', draftInput: '' },
    });
    type('hello');
    tick();
    type('hello wor');
    hook.rerender({ activeChatId: 'a', chatRow: { id: 'a', draftInput: 'hello' } });
    expect(hook.result.current[0]).toBe('hello wor');
  });

  it('keeps typed text when the row is cleared underneath (e.g. a send elsewhere)', () => {
    const { hook, type } = setup({
      activeChatId: 'a',
      chatRow: { id: 'a', draftInput: 'old' },
    });
    type('new text');
    hook.rerender({ activeChatId: 'a', chatRow: { id: 'a', draftInput: '' } });
    expect(hook.result.current[0]).toBe('new text');
  });

  it("switching chats never saves the previous chat's draft into the next one", () => {
    const { hook, persist, type, tick } = setup({
      activeChatId: 'a',
      chatRow: { id: 'a', draftInput: '' },
    });
    type('for a');
    tick();
    persist.mockClear();

    // Route switches to b; the query still holds a's row until b loads.
    hook.rerender({ activeChatId: 'b', chatRow: { id: 'a', draftInput: 'for a' } });
    tick();
    hook.rerender({ activeChatId: 'b', chatRow: undefined });
    tick();
    expect(persist).not.toHaveBeenCalled();

    hook.rerender({ activeChatId: 'b', chatRow: { id: 'b', draftInput: 'for b' } });
    expect(hook.result.current[0]).toBe('for b');
    tick();
    expect(persist).not.toHaveBeenCalled();
  });
});
