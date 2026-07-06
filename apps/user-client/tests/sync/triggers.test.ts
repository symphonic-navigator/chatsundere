// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import {
  useAccountLinkStore,
  useConnectivityStore,
  useDiscoveryStore,
  useSessionStore,
} from '@chatsundere/ui-shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _resetTriggersForTests,
  _setTriggerCycle,
  initSyncTriggers,
  scheduleClass1Sync,
  teardownSyncTriggers,
} from '../../src/sync/triggers.js';

/** A linked, unlocked account with a reachable server (all triggers pass). */
function seedLinkedOnline(): void {
  useAccountLinkStore.setState({ linkStatus: 'linked', baseUrl: 'https://server.example' });
  useDiscoveryStore.setState({
    status: 'ok',
    // biome-ignore lint/suspicious/noExplicitAny: partial store shape for the test
    config: { syncUrl: 'https://sync.example', features: ['sync'] } as any,
  });
  useConnectivityStore.setState({ state: { kind: 'linked_online' } });
  useSessionStore.setState({ session: { accessToken: 'tok' } as never, mk: {} as never });
}

function setVisibility(state: 'visible' | 'hidden'): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: state });
}

let cycle: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  cycle = vi.fn(async () => undefined);
  _setTriggerCycle(cycle);
  setVisibility('visible');
});

afterEach(() => {
  _resetTriggersForTests();
  vi.useRealTimers();
  useAccountLinkStore.setState({ linkStatus: 'unknown', baseUrl: null });
  useConnectivityStore.setState({ state: { kind: 'local_offline' } });
  useSessionStore.setState({ session: null, mk: null });
  useDiscoveryStore.setState({ status: 'unknown', config: null });
});

describe('scheduleClass1Sync — 3-second debounce', () => {
  it('fires exactly one cycle after 3 s, collapsing a burst', () => {
    seedLinkedOnline();
    scheduleClass1Sync();
    scheduleClass1Sync();
    scheduleClass1Sync();
    expect(cycle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2_999);
    expect(cycle).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(cycle).toHaveBeenCalledTimes(1);
  });

  it('re-evaluates the guard when the timer fires — no cycle if gone unlinked', () => {
    seedLinkedOnline();
    scheduleClass1Sync();
    useAccountLinkStore.setState({ linkStatus: 'local-only' });
    vi.advanceTimersByTime(3_000);
    expect(cycle).not.toHaveBeenCalled();
  });
});

describe('coarse 10-minute timer', () => {
  it('fires a cycle every 10 minutes while eligible', () => {
    seedLinkedOnline();
    initSyncTriggers();
    cycle.mockClear(); // ignore the boot cycle
    vi.advanceTimersByTime(10 * 60 * 1_000);
    expect(cycle).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(10 * 60 * 1_000);
    expect(cycle).toHaveBeenCalledTimes(2);
  });
});

describe('boot cycle after unlock', () => {
  it('fires immediately when already unlocked at init', () => {
    seedLinkedOnline();
    initSyncTriggers();
    expect(cycle).toHaveBeenCalledTimes(1);
  });

  it('fires on the lock→unlock transition', () => {
    useAccountLinkStore.setState({ linkStatus: 'linked', baseUrl: 'https://server.example' });
    useConnectivityStore.setState({ state: { kind: 'linked_online' } });
    useSessionStore.setState({ session: null, mk: null }); // locked at init
    initSyncTriggers();
    expect(cycle).not.toHaveBeenCalled();
    useSessionStore.setState({ session: { accessToken: 'tok' } as never, mk: {} as never });
    expect(cycle).toHaveBeenCalledTimes(1);
  });
});

describe('foreground + connectivity-regain triggers', () => {
  it('fires a cycle on visibilitychange → visible', () => {
    seedLinkedOnline();
    initSyncTriggers();
    cycle.mockClear();
    document.dispatchEvent(new Event('visibilitychange'));
    expect(cycle).toHaveBeenCalledTimes(1);
  });

  it('does not fire when the document goes hidden', () => {
    seedLinkedOnline();
    initSyncTriggers();
    cycle.mockClear();
    setVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(cycle).not.toHaveBeenCalled();
  });

  it('fires a cycle on the transition into linked_online (regain)', () => {
    useAccountLinkStore.setState({ linkStatus: 'linked', baseUrl: 'https://server.example' });
    useDiscoveryStore.setState({
      status: 'ok',
      // biome-ignore lint/suspicious/noExplicitAny: partial store shape for the test
      config: { syncUrl: 'https://sync.example', features: ['sync'] } as any,
    });
    useSessionStore.setState({ session: { accessToken: 'tok' } as never, mk: {} as never });
    useConnectivityStore.setState({ state: { kind: 'local_offline' } }); // offline at init
    initSyncTriggers();
    expect(cycle).not.toHaveBeenCalled();
    useConnectivityStore.setState({ state: { kind: 'linked_online' } });
    expect(cycle).toHaveBeenCalledTimes(1);
  });
});

describe('guarding: triggers no-op when unlinked', () => {
  it('does not fire the timer, foreground, or debounce when local-only', () => {
    useAccountLinkStore.setState({ linkStatus: 'local-only', baseUrl: null });
    useSessionStore.setState({ session: { accessToken: 'tok' } as never, mk: {} as never });
    initSyncTriggers();
    document.dispatchEvent(new Event('visibilitychange'));
    scheduleClass1Sync();
    vi.advanceTimersByTime(30 * 60 * 1_000);
    expect(cycle).not.toHaveBeenCalled();
  });
});

describe('teardown', () => {
  it('removes the timer, listeners, and subscriptions', () => {
    seedLinkedOnline();
    initSyncTriggers();
    cycle.mockClear();
    teardownSyncTriggers();
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(30 * 60 * 1_000);
    useConnectivityStore.setState({ state: { kind: 'local_offline' } });
    useConnectivityStore.setState({ state: { kind: 'linked_online' } });
    expect(cycle).not.toHaveBeenCalled();
  });
});
