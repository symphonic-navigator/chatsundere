// SPDX-License-Identifier: AGPL-3.0-only
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useCurrentChatStore } from '../../src/state/current-chat.store.js';
import {
  DESKTOP_MEDIA_QUERY,
  useEffectiveChatMode,
  useIsDesktop,
} from '../../src/state/effective-chat-mode.js';

type ChangeListener = () => void;

/** Replaces window.matchMedia with a controllable stub; returns a flip switch. */
function installMatchMedia(initialMatches: boolean): { setMatches: (next: boolean) => void } {
  const listeners = new Set<ChangeListener>();
  let matches = initialMatches;
  const mql = {
    get matches() {
      return matches;
    },
    media: DESKTOP_MEDIA_QUERY,
    onchange: null,
    addEventListener: (_type: string, cb: ChangeListener) => {
      listeners.add(cb);
    },
    removeEventListener: (_type: string, cb: ChangeListener) => {
      listeners.delete(cb);
    },
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  };
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: () => mql,
  });
  return {
    setMatches(next: boolean) {
      matches = next;
      for (const cb of listeners) cb();
    },
  };
}

const originalMatchMedia = window.matchMedia;

describe('effective-chat-mode', () => {
  beforeEach(() => {
    useCurrentChatStore.getState().reset();
  });
  afterEach(() => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: originalMatchMedia,
    });
  });

  it('passes the store through unchanged below the breakpoint', () => {
    installMatchMedia(false);
    const { result, rerender } = renderHook(() => useEffectiveChatMode());
    expect(result.current).toEqual({ isInteractionMode: false, isPinned: false });
    act(() => {
      useCurrentChatStore.getState().setInteractionMode(true);
      useCurrentChatStore.getState().togglePin();
    });
    rerender();
    expect(result.current).toEqual({ isInteractionMode: true, isPinned: true });
  });

  it('forces interaction and pinned at the breakpoint, without writing the store', () => {
    installMatchMedia(true);
    const { result } = renderHook(() => useEffectiveChatMode());
    expect(result.current).toEqual({ isInteractionMode: true, isPinned: true });
    // Derived, never stored (spec §5.2).
    expect(useCurrentChatStore.getState().isInteractionMode).toBe(false);
    expect(useCurrentChatStore.getState().isPinned).toBe(false);
  });

  it('reacts to a media-query flip in both directions', () => {
    const media = installMatchMedia(false);
    const { result } = renderHook(() => useIsDesktop());
    expect(result.current).toBe(false);
    act(() => media.setMatches(true));
    expect(result.current).toBe(true);
    act(() => media.setMatches(false));
    expect(result.current).toBe(false);
  });

  it('reports mobile when matchMedia is unavailable', () => {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: undefined,
    });
    const { result } = renderHook(() => useIsDesktop());
    expect(result.current).toBe(false);
  });
});
