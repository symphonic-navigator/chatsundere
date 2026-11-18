// SPDX-License-Identifier: AGPL-3.0-only
import { act, render, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BreathingOrb } from '../../src/components/BreathingOrb';
import {
  MOTION_STORAGE_KEY,
  applyMotionAttribute,
  applyStoredMotionAttribute,
  prefersReducedMotion,
  prefersSystemReducedMotion,
  useReducedMotion,
  useSystemReducedMotion,
} from '../../src/lib/reduced-motion';
import { stubReducedMotionQuery } from '../helpers/media-query-stub';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete document.documentElement.dataset.motion;
  localStorage.clear();
});

describe('prefersReducedMotion', () => {
  it('is false when neither the system nor the switch asks', () => {
    stubReducedMotionQuery(false);
    expect(prefersReducedMotion()).toBe(false);
    expect(prefersSystemReducedMotion()).toBe(false);
  });

  it('follows the system setting', () => {
    stubReducedMotionQuery(true);
    expect(prefersReducedMotion()).toBe(true);
    expect(prefersSystemReducedMotion()).toBe(true);
  });

  it('follows the root attribute, which the system-only check ignores', () => {
    stubReducedMotionQuery(false);
    document.documentElement.dataset.motion = 'reduced';
    expect(prefersReducedMotion()).toBe(true);
    expect(prefersSystemReducedMotion()).toBe(false);
  });
});

describe('applyMotionAttribute', () => {
  it('sets the attribute and mirrors only the flag to localStorage', () => {
    applyMotionAttribute(true);
    expect(document.documentElement.dataset.motion).toBe('reduced');
    expect(localStorage.getItem(MOTION_STORAGE_KEY)).toBe('1');
    expect(localStorage.length).toBe(1);
  });

  it('removes the attribute and the mirror', () => {
    applyMotionAttribute(true);
    applyMotionAttribute(false);
    expect(document.documentElement.hasAttribute('data-motion')).toBe(false);
    expect(localStorage.getItem(MOTION_STORAGE_KEY)).toBeNull();
  });

  it('still sets the attribute when storage throws', () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(() => applyMotionAttribute(true)).not.toThrow();
    expect(document.documentElement.dataset.motion).toBe('reduced');
  });
});

describe('applyStoredMotionAttribute', () => {
  it('applies the mirrored flag before the settings row is read', () => {
    localStorage.setItem(MOTION_STORAGE_KEY, '1');
    applyStoredMotionAttribute();
    expect(document.documentElement.dataset.motion).toBe('reduced');
  });

  it('leaves motion on without a stored flag', () => {
    applyStoredMotionAttribute();
    expect(document.documentElement.hasAttribute('data-motion')).toBe(false);
  });

  it('swallows unreadable storage', () => {
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });
    expect(() => applyStoredMotionAttribute()).not.toThrow();
    expect(document.documentElement.hasAttribute('data-motion')).toBe(false);
  });
});

describe('useReducedMotion', () => {
  it('updates live when the system setting changes', () => {
    const system = stubReducedMotionQuery(false);
    const { result } = renderHook(() => useReducedMotion());
    expect(result.current).toBe(false);
    act(() => system.set(true));
    expect(result.current).toBe(true);
    act(() => system.set(false));
    expect(result.current).toBe(false);
  });

  it('updates live when the root attribute changes', async () => {
    stubReducedMotionQuery(false);
    const { result } = renderHook(() => useReducedMotion());
    act(() => applyMotionAttribute(true));
    await waitFor(() => expect(result.current).toBe(true));
    act(() => applyMotionAttribute(false));
    await waitFor(() => expect(result.current).toBe(false));
  });

  it('detaches its media-query listener on unmount', () => {
    const system = stubReducedMotionQuery(false);
    const { unmount } = renderHook(() => useReducedMotion());
    expect(system.listenerCount()).toBe(1);
    unmount();
    expect(system.listenerCount()).toBe(0);
  });
});

describe('useSystemReducedMotion', () => {
  it('follows the system only, not the switch', async () => {
    const system = stubReducedMotionQuery(false);
    const { result } = renderHook(() => useSystemReducedMotion());
    act(() => applyMotionAttribute(true));
    expect(result.current).toBe(false);
    act(() => system.set(true));
    expect(result.current).toBe(true);
  });
});

describe('BreathingOrb', () => {
  function orbAnimation(container: HTMLElement): string {
    const orb = container.firstElementChild as HTMLElement;
    return orb.style.animation;
  }

  it('stops breathing when the switch flips, without a remount', async () => {
    stubReducedMotionQuery(false);
    const { container } = render(<BreathingOrb seed={7} />);
    expect(orbAnimation(container)).toContain('breathe');
    act(() => applyMotionAttribute(true));
    await waitFor(() => expect(orbAnimation(container)).toBe('none'));
    act(() => applyMotionAttribute(false));
    await waitFor(() => expect(orbAnimation(container)).toContain('breathe'));
  });
});
