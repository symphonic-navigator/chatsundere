import { afterEach, describe, expect, it, vi } from 'vitest';
import { focusMessage, scrollToMessage } from '../../src/lib/scroll-to-message.js';

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

describe('focusMessage', () => {
  it('retries once a frame later, then reports the message missing', () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      frames.push(cb);
      return frames.length;
    });
    const onMissing = vi.fn();
    focusMessage('gone', onMissing);
    frames.shift()?.(0);
    expect(onMissing).not.toHaveBeenCalled();
    frames.shift()?.(0);
    expect(onMissing).toHaveBeenCalledOnce();
  });

  it('does not report a message that mounts on the retry frame', () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      frames.push(cb);
      return frames.length;
    });
    const onMissing = vi.fn();
    focusMessage('late', onMissing);
    frames.shift()?.(0);
    const el = document.createElement('div');
    el.setAttribute('data-msg-id', 'late');
    document.body.appendChild(el);
    frames.shift()?.(0);
    expect(onMissing).not.toHaveBeenCalled();
    expect(el.classList.contains('msg-focus-pulse')).toBe(true);
  });
});
