// SPDX-License-Identifier: LGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from 'vitest';

// attachConnectivityListeners guards with a module-level flag, so each test
// gets a fresh module registry.
describe('attachConnectivityListeners regain wiring', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('invokes onRegain exactly once per online event', async () => {
    const { attachConnectivityListeners } = await import('../../src/state/connectivity.store.js');
    const onRegain = vi.fn();
    attachConnectivityListeners({ onRegain });
    window.dispatchEvent(new Event('online'));
    expect(onRegain).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('online'));
    expect(onRegain).toHaveBeenCalledTimes(2);
  });

  it('invokes onRegain when the document becomes visible, not when hidden', async () => {
    const { attachConnectivityListeners } = await import('../../src/state/connectivity.store.js');
    const onRegain = vi.fn();
    attachConnectivityListeners({ onRegain });

    const visibility = vi.spyOn(document, 'visibilityState', 'get');
    visibility.mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(onRegain).not.toHaveBeenCalled();

    visibility.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(onRegain).toHaveBeenCalledTimes(1);
  });

  it('still transitions network state on online/offline events', async () => {
    const { attachConnectivityListeners, useConnectivityStore } = await import(
      '../../src/state/connectivity.store.js'
    );
    attachConnectivityListeners({});
    useConnectivityStore.setState({ state: { kind: 'local_online' } });
    window.dispatchEvent(new Event('offline'));
    expect(useConnectivityStore.getState().state.kind).toBe('local_offline');
    window.dispatchEvent(new Event('online'));
    expect(useConnectivityStore.getState().state.kind).toBe('local_online');
  });

  it('attaches only once — a second call does not double the callbacks', async () => {
    const { attachConnectivityListeners } = await import('../../src/state/connectivity.store.js');
    const onRegain = vi.fn();
    attachConnectivityListeners({ onRegain });
    attachConnectivityListeners({ onRegain });
    window.dispatchEvent(new Event('online'));
    expect(onRegain).toHaveBeenCalledTimes(1);
  });
});
