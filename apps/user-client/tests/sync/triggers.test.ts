// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import type { SealedRecord } from '@chatsundere/crypto';
import type { SyncCollection, SyncPushRecord } from '@chatsundere/shared-types';
import {
  useAccountLinkStore,
  useConnectivityStore,
  useDiscoveryStore,
  useSessionStore,
} from '@chatsundere/ui-shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { setImmediateDrain } from '../../src/sync/enqueue.js';
import {
  _resetTriggersForTests,
  _setTriggerCycle,
  initSyncTriggers,
  scheduleClass1Sync,
  teardownSyncTriggers,
} from '../../src/sync/triggers.js';
import {
  _resetWorkerForTests,
  _setCryptoDeps,
  _setPullLoop,
  _setPushTransport,
  runSyncCycle,
} from '../../src/sync/worker.js';

// The cycle-start server-identity guard (Task 4) reads the crypto DB's linked
// account; the concurrency test below drives a real `runSyncCycle`, so stub it
// inert the same way worker.test.ts does (no account linked → never fires).
vi.mock('../../src/boot/open-db.js', () => ({
  getDb: vi.fn(() => ({}) as unknown as IDBDatabase),
}));

vi.mock('@chatsundere/crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@chatsundere/crypto')>();
  return { ...actual, getLinkedAccount: vi.fn(async () => null) };
});

// Spy on the registration call itself (finding #4a): capture exactly the
// callback `initSyncTriggers` hands to `setImmediateDrain`, so the test
// invokes the REAL production closure rather than a stand-in.
vi.mock('../../src/sync/enqueue.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/sync/enqueue.js')>();
  return { ...actual, setImmediateDrain: vi.fn() };
});

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

/** Deterministic fake crypto — no key material, no real WebCrypto needed. */
function fakeSealed(collection: string, key: string): SealedRecord {
  return {
    blindId: new TextEncoder().encode(`bid:${collection}:${key}`),
    envelopeVersion: 1,
    nonce: new Uint8Array([1, 2, 3]),
    ciphertext: new Uint8Array([9, 9]),
    ciphertextHash: new TextEncoder().encode(`hash:${collection}:${key}`),
  };
}

function installFakeCrypto(): void {
  _setCryptoDeps({
    computeBlindId: async (_mk, collection, key) =>
      new TextEncoder().encode(`bid:${collection}:${key}`),
    sealRecord: async (_mk, collection, key) => fakeSealed(collection, key),
  });
}

/**
 * Minimal Web Locks stand-in: real FIFO mutual exclusion on a single lock name
 * (only `SYNC_LOCK_NAME` is ever requested in these tests), so one global
 * queue suffices. jsdom has no `navigator.locks` at all, so both `withSyncLock`
 * and the cycle's single-flight fall back to running inline / a process-local
 * mutex — which would make this test pass trivially regardless of the fix.
 * Installing a real queue is what makes the assertion meaningful.
 */
function installLockManager(): void {
  let owner: object | null = null;
  const waiters: Array<() => void> = [];

  async function acquire(): Promise<void> {
    if (owner === null) {
      owner = {};
      return;
    }
    await new Promise<void>((resolve) => waiters.push(resolve));
    owner = {};
  }

  function release(): void {
    owner = null;
    const next = waiters.shift();
    next?.();
  }

  const request = (async (
    name: string,
    optionsOrCallback: unknown,
    maybeCallback?: (lock: { name: string; mode: string } | null) => Promise<unknown>,
  ) => {
    const isCallback = typeof optionsOrCallback === 'function';
    const options = (isCallback ? {} : optionsOrCallback) as { ifAvailable?: boolean };
    const callback = (isCallback ? optionsOrCallback : maybeCallback) as (
      lock: { name: string; mode: string } | null,
    ) => Promise<unknown>;

    if (options.ifAvailable) {
      if (owner !== null) return callback(null);
      owner = {};
      try {
        return await callback({ name, mode: 'exclusive' });
      } finally {
        release();
      }
    }

    await acquire();
    try {
      return await callback({ name, mode: 'exclusive' });
    } finally {
      release();
    }
  }) as unknown as LockManager['request'];

  Object.defineProperty(navigator, 'locks', {
    value: { request } as LockManager,
    configurable: true,
  });
}

function uninstallLockManager(): void {
  Reflect.deleteProperty(navigator, 'locks');
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

describe('the immediate drain runs under the sync Web Lock (finding #4a)', () => {
  beforeEach(async () => {
    // This block drives a REAL `runSyncCycle` concurrently with the captured
    // immediate-drain callback, so it needs real timers (to actually let both
    // promises interleave) and a real client-data DB (drainOutbox reads it).
    vi.useRealTimers();
    await _resetClientDataDbForTests();
    await openClientDataDb();
    seedLinkedOnline();
    installFakeCrypto();
    installLockManager();
  });

  afterEach(async () => {
    uninstallLockManager();
    _resetWorkerForTests();
    await _resetClientDataDbForTests();
  });

  it('blocks the immediate drain until a lock-holding runSyncCycle releases the lock', async () => {
    const db = getClientDataDb();
    await db.personas.put({ id: 'a' } as never);
    await db.personas.put({ id: 'b' } as never);
    await db.syncOutbox.add({
      collection: 'personas' as SyncCollection,
      key: 'a',
      op: 'upsert',
      enqueuedAt: Date.now(),
    });

    // The push transport is the shared choke point for both drains: the FIRST
    // call (the cycle's) parks on `firstGate` so we get a window in which a
    // second, concurrent call would be observable if the immediate drain were
    // unlocked. `events` records start/end so a genuine interleave (RED) is
    // distinguishable from correct serialisation (GREEN) even if timing alone
    // is inconclusive.
    const events: string[] = [];
    let callCount = 0;
    let releaseFirst: () => void = () => undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const push = vi.fn(async (records: SyncPushRecord[]) => {
      callCount += 1;
      const n = callCount;
      events.push(`start:${n}`);
      if (n === 1) await firstGate;
      events.push(`end:${n}`);
      return {
        head: n,
        epoch: 'E1',
        results: records.map((_, i) => ({ status: 'ok' as const, rev: i + 1 })),
      };
    });
    _setPushTransport(push);
    _setPullLoop(vi.fn(async () => undefined));

    initSyncTriggers();
    const capturedDrain = vi.mocked(setImmediateDrain).mock.calls[0]?.[0];
    if (!capturedDrain) throw new Error('initSyncTriggers did not register an immediate drain');

    const cyclePromise = runSyncCycle();
    await vi.waitFor(() => expect(push).toHaveBeenCalledTimes(1));

    // A second key arrives for the write-through path while the cycle is
    // mid-flight, still holding the lock.
    await db.syncOutbox.add({
      collection: 'personas' as SyncCollection,
      key: 'b',
      op: 'upsert',
      enqueuedAt: Date.now(),
    });
    const immediatePromise = capturedDrain({ collection: 'personas' as SyncCollection, key: 'b' });

    // Give the immediate drain several real turns of the event loop to
    // (mis)fire before the cycle releases. Under the pre-fix raw `drainOutbox()`
    // call this consistently reaches a second `push` well within 20 ms.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(push).toHaveBeenCalledTimes(1);

    releaseFirst();
    await Promise.all([cyclePromise, immediatePromise]);

    expect(push).toHaveBeenCalledTimes(2);
    expect(events).toEqual(['start:1', 'end:1', 'start:2', 'end:2']);
  });
});
