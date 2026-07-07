// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import {
  useAccountLinkStore,
  useConnectivityStore,
  useDiscoveryStore,
  useSessionStore,
} from '@chatsundere/ui-shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db.js';
import {
  _resetTransportFailuresForTests,
  getSyncState,
  setAttention,
} from '../../src/sync/watermark.js';
import { _resetWorkerForTests, _setPullLoop, runSyncCycle } from '../../src/sync/worker.js';

// The crypto IDB connection is opaque to the cycle's `enforceServerIdentity`
// guard — it is only ever passed straight into the mocked `getLinkedAccount`
// below — so a dummy value is enough; no real connection needs opening here.
vi.mock('../../src/boot/open-db.js', () => ({
  getDb: vi.fn(() => ({}) as unknown as IDBDatabase),
}));

vi.mock('@chatsundere/crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@chatsundere/crypto')>();
  return { ...actual, getLinkedAccount: vi.fn(async () => null) };
});

/**
 * Pre-test analysis #8 — persistent whole-cycle transport failures must surface.
 * Three consecutive failed cycles (while connectivity believes the server
 * reachable) raise the `transport_failing` attention; the next completed cycle
 * retires it, resets the streak, and stamps `lastSyncAt`.
 */

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

/** One cycle whose pull loop dies on transport (empty outbox → the cycle always pulls). */
async function runFailingCycle(): Promise<void> {
  _setPullLoop(async () => {
    throw new Error('sync-service unreachable');
  });
  await expect(runSyncCycle()).rejects.toThrow('sync-service unreachable');
}

/** One cycle that completes cleanly (no-op pull loop). */
async function runCompletedCycle(): Promise<void> {
  _setPullLoop(async () => undefined);
  await runSyncCycle();
}

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
  _resetWorkerForTests();
  _resetTransportFailuresForTests();
  seedLinkedOnline();
});

afterEach(async () => {
  _resetWorkerForTests();
  _resetTransportFailuresForTests();
  await _resetClientDataDbForTests();
  useAccountLinkStore.setState({ linkStatus: 'unknown', baseUrl: null });
  useDiscoveryStore.setState({ status: 'unknown', config: null });
  useConnectivityStore.setState({ state: { kind: 'local_offline' } });
  useSessionStore.setState({ session: null, mk: null });
});

describe('transport_failing attention (pre-test analysis #8)', () => {
  it('raises after three consecutive failed cycles', async () => {
    await runFailingCycle();
    await runFailingCycle();
    expect((await getSyncState()).attention).toBeNull();
    await runFailingCycle();
    expect((await getSyncState()).attention).toEqual({ kind: 'transport_failing' });
  });

  it('a completed cycle in between resets the streak', async () => {
    await runFailingCycle();
    await runFailingCycle();
    await runCompletedCycle();
    await runFailingCycle();
    await runFailingCycle();
    expect((await getSyncState()).attention).toBeNull();
  });

  it('the next completed cycle retires the banner and stamps lastSyncAt', async () => {
    await runFailingCycle();
    await runFailingCycle();
    await runFailingCycle();
    expect((await getSyncState()).attention).toEqual({ kind: 'transport_failing' });

    await runCompletedCycle();
    const state = await getSyncState();
    expect(state.attention).toBeNull();
    expect(state.lastSyncAt).not.toBeNull();
  });

  it('failures while the device knows it is offline never count', async () => {
    // The browser's offline event flips a linked device to `server_unreachable`;
    // that state is already surfaced calmly (ConnectivityBadge, offline status),
    // so ordinary airplane-mode must not accumulate towards the alarm banner.
    useConnectivityStore.setState({ state: { kind: 'server_unreachable' } });
    await runFailingCycle();
    await runFailingCycle();
    await runFailingCycle();
    expect((await getSyncState()).attention).toBeNull();
  });

  it('never clobbers a more specific attention state', async () => {
    await setAttention({ kind: 'quota_exceeded', usedBytes: 10, quotaBytes: 5 });
    await runFailingCycle();
    await runFailingCycle();
    await runFailingCycle();
    expect((await getSyncState()).attention).toEqual({
      kind: 'quota_exceeded',
      usedBytes: 10,
      quotaBytes: 5,
    });
  });

  it('a completed cycle never retires a foreign attention state', async () => {
    await setAttention({ kind: 'quota_exceeded', usedBytes: 10, quotaBytes: 5 });
    await runCompletedCycle();
    expect((await getSyncState()).attention).toEqual({
      kind: 'quota_exceeded',
      usedBytes: 10,
      quotaBytes: 5,
    });
  });
});
