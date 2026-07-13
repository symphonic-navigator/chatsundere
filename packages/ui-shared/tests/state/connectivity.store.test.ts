// SPDX-License-Identifier: LGPL-3.0-only
import { beforeEach, describe, expect, it } from 'vitest';
import { useConnectivityStore } from '../../src/state/connectivity.store.js';

function getKind() {
  return useConnectivityStore.getState().state.kind;
}

function reset(kind: ReturnType<typeof getKind> = 'local_offline') {
  useConnectivityStore.setState({ state: { kind } });
}

describe('useConnectivityStore — initial state', () => {
  it('starts in local_offline', () => {
    reset();
    expect(getKind()).toBe('local_offline');
  });
});

describe('onNetworkOnline', () => {
  beforeEach(() => reset());

  it('transitions local_offline → local_online', () => {
    useConnectivityStore.getState().onNetworkOnline();
    expect(getKind()).toBe('local_online');
  });

  it('is a no-op from linked_online', () => {
    reset('linked_online');
    useConnectivityStore.getState().onNetworkOnline();
    expect(getKind()).toBe('linked_online');
  });

  it('is a no-op from server_unreachable', () => {
    reset('server_unreachable');
    useConnectivityStore.getState().onNetworkOnline();
    expect(getKind()).toBe('server_unreachable');
  });

  it('is a no-op from server_auth_failed', () => {
    reset('server_auth_failed');
    useConnectivityStore.getState().onNetworkOnline();
    expect(getKind()).toBe('server_auth_failed');
  });
});

describe('onNetworkOffline', () => {
  beforeEach(() => reset());

  it('transitions local_online → local_offline', () => {
    reset('local_online');
    useConnectivityStore.getState().onNetworkOffline();
    expect(getKind()).toBe('local_offline');
  });

  it('transitions linked_online → server_unreachable', () => {
    reset('linked_online');
    useConnectivityStore.getState().onNetworkOffline();
    expect(getKind()).toBe('server_unreachable');
  });

  it('transitions server_auth_failed → server_unreachable', () => {
    reset('server_auth_failed');
    useConnectivityStore.getState().onNetworkOffline();
    expect(getKind()).toBe('server_unreachable');
  });

  it('transitions server_rate_limited → server_unreachable', () => {
    reset('server_rate_limited');
    useConnectivityStore.getState().onNetworkOffline();
    expect(getKind()).toBe('server_unreachable');
  });

  it('transitions server_unreachable → server_unreachable (stays)', () => {
    reset('server_unreachable');
    useConnectivityStore.getState().onNetworkOffline();
    expect(getKind()).toBe('server_unreachable');
  });

  it('is a no-op from local_offline', () => {
    reset('local_offline');
    useConnectivityStore.getState().onNetworkOffline();
    expect(getKind()).toBe('local_offline');
  });
});

describe('onServerOk', () => {
  const allStates = [
    'local_offline',
    'local_online',
    'linked_online',
    'server_unreachable',
    'server_rate_limited',
    'server_auth_failed',
  ] as const;

  for (const from of allStates) {
    it(`transitions ${from} → linked_online`, () => {
      reset(from);
      useConnectivityStore.getState().onServerOk();
      expect(getKind()).toBe('linked_online');
    });
  }
});

describe('onServerUnreachable', () => {
  it('transitions to server_unreachable from any state', () => {
    reset('local_online');
    useConnectivityStore.getState().onServerUnreachable();
    expect(getKind()).toBe('server_unreachable');
  });
});

describe('onServerRateLimited', () => {
  it('transitions to server_rate_limited from any state', () => {
    reset('linked_online');
    useConnectivityStore.getState().onServerRateLimited();
    expect(getKind()).toBe('server_rate_limited');
  });

  it('records retryAt in the future when given a retry-after hint', () => {
    reset('linked_online');
    const before = Date.now();
    useConnectivityStore.getState().onServerRateLimited(120);
    const s = useConnectivityStore.getState().state;
    expect(s.kind).toBe('server_rate_limited');
    if (s.kind === 'server_rate_limited') {
      expect(s.retryAt).toBeGreaterThanOrEqual(before + 120_000);
      expect(s.retryAt).toBeLessThanOrEqual(Date.now() + 120_000);
    }
  });

  it('leaves retryAt undefined when no hint is given', () => {
    reset('linked_online');
    useConnectivityStore.getState().onServerRateLimited();
    const s = useConnectivityStore.getState().state;
    if (s.kind === 'server_rate_limited') expect(s.retryAt).toBeUndefined();
  });

  it('is cleared by a subsequent onServerOk (self-heals to linked_online)', () => {
    reset('server_rate_limited');
    useConnectivityStore.getState().onServerOk();
    expect(getKind()).toBe('linked_online');
  });
});

describe('onServerAuthFailed', () => {
  it('transitions to server_auth_failed from any state', () => {
    reset('linked_online');
    useConnectivityStore.getState().onServerAuthFailed();
    expect(getKind()).toBe('server_auth_failed');
  });
});
