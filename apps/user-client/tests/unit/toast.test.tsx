import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Toast } from '../../src/components/Toast';
import { toastStore } from '../../src/state/toast.store';

beforeEach(() => {
  // reset by clearing the array directly via the store API
  toastStore.clear();
});

describe('Toast', () => {
  it('renders nothing when empty', () => {
    const { container } = render(<Toast />);
    expect(container.querySelector('.toast')).toBeNull();
  });

  it('toastStore.show queues a toast that renders', () => {
    const { container } = render(<Toast />);
    act(() => {
      toastStore.show({ message: 'hello', tone: 'info', durationMs: 100 });
    });
    const t = container.querySelector('.toast');
    expect(t).not.toBeNull();
    expect(t?.textContent).toContain('hello');
    expect(t?.getAttribute('data-tone')).toBe('info');
  });

  it('auto-dismisses after durationMs', async () => {
    vi.useFakeTimers();
    const { container } = render(<Toast />);
    act(() => {
      toastStore.show({ message: 'gone soon', tone: 'warn', durationMs: 200 });
    });
    expect(container.querySelector('.toast')).not.toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(250);
    });
    expect(container.querySelector('.toast')).toBeNull();
    vi.useRealTimers();
  });

  it('multiple toasts queue and each dismiss independently', async () => {
    vi.useFakeTimers();
    const { container } = render(<Toast />);
    act(() => {
      toastStore.show({ message: 'first', tone: 'info', durationMs: 100 });
      toastStore.show({ message: 'second', tone: 'success', durationMs: 300 });
    });
    expect(container.querySelectorAll('.toast').length).toBe(2);
    await act(async () => {
      vi.advanceTimersByTime(150);
    });
    expect(container.querySelectorAll('.toast').length).toBe(1);
    expect(container.querySelector('.toast')?.textContent).toContain('second');
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(container.querySelectorAll('.toast').length).toBe(0);
    vi.useRealTimers();
  });

  it('exposes tone via data-tone', () => {
    const { container } = render(<Toast />);
    act(() => {
      toastStore.show({ message: 'be careful', tone: 'warn', durationMs: 100 });
    });
    expect(container.querySelector('.toast')?.getAttribute('data-tone')).toBe('warn');
  });
});
