// SPDX-License-Identifier: AGPL-3.0-only
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useNavZoom } from '../../src/lib/use-nav-zoom.js';
import { useNavTransitionStore } from '../../src/state/nav-transition.store.js';

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => mockNavigate,
}));

const mockReducedMotion = vi.fn();
vi.mock('@chatsundere/ui-shared', () => ({
  motion: { respectsReducedMotion: () => mockReducedMotion() },
}));

function makeEl(): HTMLElement {
  const el = document.createElement('div');
  el.getBoundingClientRect = () =>
    ({
      left: 10,
      top: 20,
      width: 100,
      height: 50,
      right: 110,
      bottom: 70,
      x: 10,
      y: 20,
      toJSON: () => ({}),
    }) as DOMRect;
  return el;
}

function wrapper({ children }: { children: ReactNode }) {
  return <MemoryRouter initialEntries={['/app']}>{children}</MemoryRouter>;
}

describe('useNavZoom', () => {
  beforeEach(() => {
    mockNavigate.mockReset();
    useNavTransitionStore.setState({ originRect: null, lastOrigin: null });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('under reduced motion: arms the store and navigates immediately', () => {
    mockReducedMotion.mockReturnValue(true);
    const { result } = renderHook(() => useNavZoom(), { wrapper });
    const el = makeEl();
    result.current(el, '/app/circle');
    expect(useNavTransitionStore.getState().lastOrigin).not.toBeNull();
    expect(useNavTransitionStore.getState().lastOrigin?.path).toBe('/app');
    expect(mockNavigate).toHaveBeenCalledWith('/app/circle');
  });

  it('under full motion: arms the store, adds cs-tile-blink, does NOT navigate synchronously', () => {
    mockReducedMotion.mockReturnValue(false);
    const { result } = renderHook(() => useNavZoom(), { wrapper });
    const el = makeEl();
    result.current(el, '/app/circle');
    // Store is armed synchronously.
    expect(useNavTransitionStore.getState().lastOrigin).not.toBeNull();
    // Blink class added.
    expect(el.classList.contains('cs-tile-blink')).toBe(true);
    // Navigation has NOT fired yet.
    expect(mockNavigate).not.toHaveBeenCalled();
    // After 260 ms, navigation fires.
    vi.advanceTimersByTime(260);
    expect(mockNavigate).toHaveBeenCalledWith('/app/circle');
  });
});
