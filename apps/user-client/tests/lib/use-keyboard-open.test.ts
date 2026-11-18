// SPDX-License-Identifier: AGPL-3.0-only
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useKeyboardOpen } from '../../src/lib/use-keyboard-open.js';

class FakeVisualViewport extends EventTarget {
  height: number;
  constructor(height: number) {
    super();
    this.height = height;
  }
  resizeTo(height: number): void {
    this.height = height;
    this.dispatchEvent(new Event('resize'));
  }
}

const original = Object.getOwnPropertyDescriptor(window, 'visualViewport');
const isOpen = (): boolean => document.documentElement.hasAttribute('data-keyboard-open');

function install(vv: FakeVisualViewport | undefined): void {
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: vv });
}

describe('useKeyboardOpen', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
  });
  afterEach(() => {
    if (original) Object.defineProperty(window, 'visualViewport', original);
    else Reflect.deleteProperty(window, 'visualViewport');
    document.documentElement.removeAttribute('data-keyboard-open');
  });

  it('marks <html> while the visual viewport is shrunk by more than 120 px', () => {
    const vv = new FakeVisualViewport(800);
    install(vv);
    renderHook(() => useKeyboardOpen());
    expect(isOpen()).toBe(false);
    vv.resizeTo(450);
    expect(isOpen()).toBe(true);
    vv.resizeTo(800);
    expect(isOpen()).toBe(false);
  });

  it('ignores a small shrink such as the URL bar collapsing', () => {
    const vv = new FakeVisualViewport(800);
    install(vv);
    renderHook(() => useKeyboardOpen());
    vv.resizeTo(700);
    expect(isOpen()).toBe(false);
  });

  it('reads the state on mount', () => {
    install(new FakeVisualViewport(400));
    renderHook(() => useKeyboardOpen());
    expect(isOpen()).toBe(true);
  });

  it('removes the attribute and stops listening on unmount', () => {
    const vv = new FakeVisualViewport(400);
    install(vv);
    const { unmount } = renderHook(() => useKeyboardOpen());
    expect(isOpen()).toBe(true);
    unmount();
    expect(isOpen()).toBe(false);
    vv.resizeTo(300);
    expect(isOpen()).toBe(false);
  });

  it('does nothing without visualViewport', () => {
    install(undefined);
    expect(() => renderHook(() => useKeyboardOpen())).not.toThrow();
    expect(isOpen()).toBe(false);
  });
});
