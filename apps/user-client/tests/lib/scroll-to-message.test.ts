import { afterEach, describe, expect, it, vi } from 'vitest';
import { scrollToMessage } from '../../src/lib/scroll-to-message.js';

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('scrollToMessage', () => {
  it('returns false when no element matches', () => {
    expect(scrollToMessage('missing')).toBe(false);
  });

  it('scrolls the matching element into view and pulses, then clears', () => {
    vi.useFakeTimers();
    const el = document.createElement('div');
    el.setAttribute('data-msg-id', 'm1');
    const scrollSpy = vi.fn();
    (el as unknown as { scrollIntoView: () => void }).scrollIntoView = scrollSpy;
    document.body.appendChild(el);

    expect(scrollToMessage('m1')).toBe(true);
    expect(scrollSpy).toHaveBeenCalledOnce();
    expect(el.classList.contains('msg-focus-pulse')).toBe(true);

    vi.runAllTimers();
    expect(el.classList.contains('msg-focus-pulse')).toBe(false);
  });
});
