// SPDX-License-Identifier: AGPL-3.0-only
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  holdScreen,
  letScreen,
  resetScreenWakeLockForTests,
} from '../../../src/lib/voice/screen-wake-lock.js';
import { useScreenWakeLock } from '../../../src/lib/voice/use-screen-wake-lock.js';

class FakeSentinel extends EventTarget {
  released = false;
  readonly type = 'screen';
  onrelease = null;
  release = vi.fn(async () => {
    if (this.released) return;
    this.released = true;
    this.dispatchEvent(new Event('release'));
  });
}

let visibility: DocumentVisibilityState = 'visible';
let sentinels: FakeSentinel[] = [];
let request: ReturnType<typeof vi.fn>;

function installWakeLock(impl?: () => Promise<FakeSentinel>): void {
  request = vi.fn(
    impl ??
      (async () => {
        const s = new FakeSentinel();
        sentinels.push(s);
        return s;
      }),
  );
  Object.defineProperty(navigator, 'wakeLock', {
    configurable: true,
    value: { request },
  });
}

function setVisibility(v: DocumentVisibilityState): void {
  visibility = v;
  document.dispatchEvent(new Event('visibilitychange'));
}

const flush = () => act(async () => {});

beforeEach(() => {
  resetScreenWakeLockForTests();
  sentinels = [];
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibility,
  });
});

afterEach(() => {
  resetScreenWakeLockForTests();
  // biome-ignore lint/performance/noDelete: the fake must vanish for the no-API case.
  delete (navigator as { wakeLock?: unknown }).wakeLock;
  vi.restoreAllMocks();
});

describe('screen wake lock', () => {
  it('does nothing and does not throw without the API', () => {
    expect(() => {
      holdScreen('read-aloud');
      letScreen('read-aloud');
    }).not.toThrow();
  });

  it('keeps one lock across overlapping reasons with no release in between', async () => {
    installWakeLock();
    holdScreen('live-voice');
    await flush();
    holdScreen('read-aloud');
    letScreen('live-voice');
    await flush();
    expect(request).toHaveBeenCalledTimes(1);
    expect(sentinels[0]?.release).not.toHaveBeenCalled();
  });

  it('releases when the last reason goes', async () => {
    installWakeLock();
    holdScreen('monologue');
    await flush();
    letScreen('monologue');
    await flush();
    expect(sentinels[0]?.release).toHaveBeenCalledTimes(1);
  });

  it('coalesces concurrent requests', async () => {
    installWakeLock();
    holdScreen('live-voice');
    holdScreen('read-aloud');
    await flush();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('does not request while hidden, and re-acquires on the return to visible', async () => {
    installWakeLock();
    visibility = 'hidden';
    holdScreen('live-voice');
    await flush();
    expect(request).not.toHaveBeenCalled();

    setVisibility('visible');
    await flush();
    expect(request).toHaveBeenCalledTimes(1);

    // The platform drops the lock when the page hides.
    await act(async () => {
      await sentinels[0]?.release();
    });
    setVisibility('hidden');
    setVisibility('visible');
    await flush();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('does not re-acquire on visibility once every reason has gone', async () => {
    installWakeLock();
    holdScreen('live-voice');
    await flush();
    letScreen('live-voice');
    setVisibility('hidden');
    setVisibility('visible');
    await flush();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('swallows a rejected request, logging at debug only', async () => {
    const debug = vi.spyOn(console, 'debug').mockImplementation(() => {});
    installWakeLock(() => Promise.reject(new DOMException('denied', 'NotAllowedError')));
    expect(() => holdScreen('read-aloud')).not.toThrow();
    await flush();
    expect(debug).toHaveBeenCalled();
    // A later attempt is not blocked by the failed one.
    setVisibility('visible');
    await flush();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('releases a sentinel that arrives after its reason was let go', async () => {
    let resolve: (s: FakeSentinel) => void = () => {};
    installWakeLock(
      () =>
        new Promise<FakeSentinel>((r) => {
          resolve = r;
        }),
    );
    holdScreen('read-aloud');
    letScreen('read-aloud');
    const late = new FakeSentinel();
    resolve(late);
    await flush();
    expect(late.release).toHaveBeenCalledTimes(1);
  });

  it('lets its reason go when the hook unmounts', async () => {
    installWakeLock();
    const { unmount } = renderHook(() => useScreenWakeLock('read-aloud', true));
    await flush();
    expect(request).toHaveBeenCalledTimes(1);
    unmount();
    await flush();
    expect(sentinels[0]?.release).toHaveBeenCalledTimes(1);
  });

  it('lets go when the hook turns inactive', async () => {
    installWakeLock();
    const { rerender } = renderHook(({ on }) => useScreenWakeLock('monologue', on), {
      initialProps: { on: true },
    });
    await flush();
    rerender({ on: false });
    await flush();
    expect(sentinels[0]?.release).toHaveBeenCalledTimes(1);
  });
});
