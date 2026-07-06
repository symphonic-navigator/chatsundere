// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import type { SealedRecord } from '@chatsundere/crypto';
import type { SyncPullResponse, SyncPushRecord } from '@chatsundere/shared-types';
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
import { _resetApplyForTests, _setApplyOpenRecord } from '../../src/sync/apply.js';
import {
  _resetRecoveryForTests,
  _setRecoveryPull,
  _setRecoverySleep,
  isEnginePaused,
  retryRecovery,
  runRecovery,
} from '../../src/sync/recovery.js';
import { getSyncState } from '../../src/sync/watermark.js';
import { isRecovering } from '../../src/sync/watermark.js';
import { _resetWorkerForTests, _setCryptoDeps, _setPushTransport } from '../../src/sync/worker.js';

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

/** An empty pull page reporting a given epoch (the fresh-reset server case). */
function emptyPull(epoch: string): SyncPullResponse {
  return { head: 0, epoch, more: false, records: [] };
}

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
  seedLinkedOnline();
  installFakeCrypto();
  _setRecoverySleep(async () => undefined); // no real backoff sleep in tests
});

afterEach(async () => {
  _resetRecoveryForTests();
  _resetWorkerForTests();
  _resetApplyForTests();
  await _resetClientDataDbForTests();
  useAccountLinkStore.setState({ linkStatus: 'unknown', baseUrl: null });
  useConnectivityStore.setState({ state: { kind: 'local_offline' } });
  useSessionStore.setState({ session: null, mk: null });
  useDiscoveryStore.setState({ status: 'unknown', config: null });
});

describe('runRecovery — full sequence (spec §8)', () => {
  it('clears CAS bases, re-pushes local rows, and persists the new epoch last', async () => {
    const db = getClientDataDb();
    // A local persona plus a STALE syncRows CAS base against the old epoch.
    await db.personas.add({ id: 'p1', name: 'Ada', updatedAt: 100 } as never);
    await db.syncRows.put({ collection: 'personas', key: 'p1', rev: 5, ciphertextHash: 'old' });

    _setRecoveryPull(async () => emptyPull('E2'));
    const pushed: SyncPushRecord[][] = [];
    _setPushTransport(async (records) => {
      pushed.push(records);
      return {
        head: 10,
        epoch: 'E2',
        results: records.map((_r, i) => ({ status: 'ok', rev: 10 + i })),
      };
    });

    await runRecovery();

    // The re-push happened: the persona was sealed fresh with baseRev 0 (the old
    // CAS base was invalidated in step 2, and the empty pull-all restored none).
    expect(pushed).toHaveLength(1);
    const personaRec = pushed[0]?.find((r) => r.collection === 'personas');
    expect(personaRec).toMatchObject({ collection: 'personas', baseRev: 0 });
    // The drain's ok result re-established the CAS base at the new rev — the
    // stale rev 5 was invalidated in step 2, never carried through.
    const meta = await db.syncRows.get(['personas', 'p1']);
    expect(meta?.rev).toBeGreaterThanOrEqual(10);
    // Epoch persisted (step 5) and the recovering flag cleared.
    expect((await getSyncState()).epoch).toBe('E2');
    expect(isRecovering()).toBe(false);
    // Outbox fully drained.
    expect(await db.syncOutbox.count()).toBe(0);
  });
});

describe('runRecovery — epoch persisted LAST (crash-sim re-runs)', () => {
  it('a re-push failure leaves the epoch unpersisted; a retry completes', async () => {
    const db = getClientDataDb();
    await db.personas.add({ id: 'p1', name: 'Ada', updatedAt: 100 } as never);
    _setRecoveryPull(async () => emptyPull('E2'));

    // First attempt: the re-push drain throws AFTER the pull-all — a crash
    // between steps 3/4 and the step-5 epoch persist.
    _setPushTransport(async () => {
      throw new Error('network down mid re-push');
    });
    await expect(runRecovery()).rejects.toThrow('network down');
    expect((await getSyncState()).epoch).toBeNull(); // NOT persisted
    expect(isRecovering()).toBe(false); // finally cleared the flag

    // Second attempt (recovery re-runs): the drain now succeeds → epoch persists.
    _setPushTransport(async (records) => ({
      head: 10,
      epoch: 'E2',
      results: records.map((_r, i) => ({ status: 'ok', rev: 10 + i })),
    }));
    await runRecovery();
    expect((await getSyncState()).epoch).toBe('E2');
  });
});

describe('runRecovery — flap containment (Larissa M-4)', () => {
  it('stops the engine with recovery_paused after more than 2 within an hour', async () => {
    _setRecoveryPull(async () => emptyPull('E2'));
    _setPushTransport(async (records) => ({
      head: 0,
      epoch: 'E2',
      results: records.map((_r, i) => ({ status: 'ok', rev: i })),
    }));

    await runRecovery();
    await runRecovery();
    expect(isEnginePaused()).toBe(false);
    await runRecovery(); // the third within the hour trips the limit
    expect(isEnginePaused()).toBe(true);
    expect((await getSyncState()).attention).toEqual({ kind: 'recovery_paused' });
    expect(isRecovering()).toBe(false);

    // A further call while paused is a no-op — the pull is not re-invoked.
    const pull = vi.fn(async () => emptyPull('E2'));
    _setRecoveryPull(pull);
    await runRecovery();
    expect(pull).not.toHaveBeenCalled();

    // retryRecovery() clears the pause and re-runs.
    await retryRecovery();
    expect(isEnginePaused()).toBe(false);
    expect(pull).toHaveBeenCalled();
    expect((await getSyncState()).attention).toBeNull();
  });
});

describe('runRecovery — settings server-wins still honours the replay guard (I-5)', () => {
  it('does not roll settings back to an older pulled value', async () => {
    const db = getClientDataDb();
    // Local settings are strictly newer knowledge (updatedAt 2000).
    await db.settings.put({ id: 1, updatedAt: 2000 } as never);

    // The pull-all delivers an OLDER settings blob (updatedAt 1000) — a replay.
    _setApplyOpenRecord(async () => ({ id: '1', updatedAt: 1000 }));
    _setRecoveryPull(async (since) =>
      since === 0
        ? {
            head: 3,
            epoch: 'E2',
            more: false,
            records: [
              {
                blindId: 'YmlkOnNldHRpbmdzOjE',
                collection: 'settings',
                rev: 3,
                deleted: false,
                nonce: 'AQ',
                ciphertext: 'CQ',
              },
            ],
          }
        : emptyPull('E2'),
    );
    _setPushTransport(async (records) => ({
      head: 3,
      epoch: 'E2',
      results: records.map((_r, i) => ({ status: 'ok', rev: 3 + i })),
    }));

    await runRecovery();

    // The replay guard kept the newer local settings — NOT rolled back to 1000.
    const settings = await db.settings.get(1);
    expect((settings as unknown as { updatedAt: number }).updatedAt).toBe(2000);
  });
});
