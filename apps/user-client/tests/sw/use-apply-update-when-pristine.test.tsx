// SPDX-License-Identifier: AGPL-3.0-only
import { useSessionStore } from '@chatsundere/ui-shared';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetAppUpdateForTests, useAppUpdateStore } from '../../src/sw/app-update.store.js';
import { useApplyUpdateWhenPristine } from '../../src/sw/use-apply-update-when-pristine.js';

vi.mock('../../src/sw/presence.js', () => ({ otherClientsOpen: vi.fn() }));

const { otherClientsOpen } = await import('../../src/sw/presence.js');
const mockOtherClientsOpen = vi.mocked(otherClientsOpen);

describe('useApplyUpdateWhenPristine (spec 2026-09-26 §2.4)', () => {
  let apply: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    _resetAppUpdateForTests();
    mockOtherClientsOpen.mockReset();
    useSessionStore.setState({ session: null });
    apply = vi.fn(() => true);
    useAppUpdateStore.getState().bind({ apply, check: async () => 'none', peek: () => 'none' });
  });

  it('applies when update-ready, pristine and sole client', async () => {
    mockOtherClientsOpen.mockResolvedValue(false);
    useAppUpdateStore.getState().markUpdateReady();
    renderHook(() => useApplyUpdateWhenPristine(true));
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
  });

  it('does not apply when another client answers', async () => {
    mockOtherClientsOpen.mockResolvedValue(true);
    useAppUpdateStore.getState().markUpdateReady();
    renderHook(() => useApplyUpdateWhenPristine(true));
    await waitFor(() => expect(mockOtherClientsOpen).toHaveBeenCalled());
    expect(apply).not.toHaveBeenCalled();
  });

  it('does not apply when not pristine', async () => {
    mockOtherClientsOpen.mockResolvedValue(false);
    useAppUpdateStore.getState().markUpdateReady();
    renderHook(() => useApplyUpdateWhenPristine(false));
    expect(mockOtherClientsOpen).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
  });

  it('applies once the form becomes pristine again', async () => {
    mockOtherClientsOpen.mockResolvedValue(false);
    useAppUpdateStore.getState().markUpdateReady();
    const { rerender } = renderHook(({ pristine }) => useApplyUpdateWhenPristine(pristine), {
      initialProps: { pristine: false },
    });
    expect(apply).not.toHaveBeenCalled();
    rerender({ pristine: true });
    await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
  });

  it('does not apply if the form stops being pristine during the presence wait', async () => {
    let resolvePresence: ((othersOpen: boolean) => void) | undefined;
    mockOtherClientsOpen.mockReturnValue(
      new Promise((resolve) => {
        resolvePresence = resolve;
      }),
    );
    useAppUpdateStore.getState().markUpdateReady();
    const { rerender } = renderHook(({ pristine }) => useApplyUpdateWhenPristine(pristine), {
      initialProps: { pristine: true },
    });
    await waitFor(() => expect(mockOtherClientsOpen).toHaveBeenCalledTimes(1));
    rerender({ pristine: false });
    resolvePresence?.(false);
    // Give any queued microtasks a chance to run before asserting the negative.
    await new Promise((r) => setTimeout(r, 0));
    expect(apply).not.toHaveBeenCalled();
  });

  it('never applies while a session is present', async () => {
    mockOtherClientsOpen.mockResolvedValue(false);
    useSessionStore.setState({ session: {} as never });
    useAppUpdateStore.getState().markUpdateReady();
    renderHook(() => useApplyUpdateWhenPristine(true));
    await waitFor(() => expect(mockOtherClientsOpen).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 0));
    expect(apply).not.toHaveBeenCalled();
  });
});
