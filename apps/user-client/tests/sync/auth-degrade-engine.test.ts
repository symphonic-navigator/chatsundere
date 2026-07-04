// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import type { SealedRecord } from '@chatsundere/crypto';
import {
  useAccountLinkStore,
  useConnectivityStore,
  useDiscoveryStore,
  useSessionStore,
} from '@chatsundere/ui-shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import {
  _resetAuthDegradeForTests,
  armAuthDegradeFromBoot,
  isAuthDegraded,
  setAuthDegraded,
} from '../../src/lib/auth-degrade.js';
import { isClass2Allowed } from '../../src/sync/gate.js';
import { setAttention } from '../../src/sync/watermark.js';
import {
  _resetWorkerForTests,
  _setCryptoDeps,
  _setPushTransport,
  drainOutbox,
  runSyncCycle,
} from '../../src/sync/worker.js';

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

async function addOutbox(collection: string, key: string, op: 'upsert' | 'delete'): Promise<void> {
  await getClientDataDb().syncOutbox.add({
    // biome-ignore lint/suspicious/noExplicitAny: SyncCollection narrowed by callers
    collection: collection as any,
    key,
    op,
    enqueuedAt: Date.now(),
  });
}

/** The one refusal shape the auth service emits: 401 with envelope code `unauthorized`. */
function refusalResponse(): Response {
  return new Response(JSON.stringify({ error: { code: 'unauthorized' } }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
}

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
  _resetAuthDegradeForTests();
  seedLinkedOnline();
  installFakeCrypto();
});

afterEach(async () => {
  _resetWorkerForTests();
  // Clear any latched auth-degraded attention so the latch never leaks between
  // tests (the DB reset below wipes it too, but be explicit about intent).
  await setAttention(null);
  _resetAuthDegradeForTests();
  await _resetClientDataDbForTests();
  useAccountLinkStore.setState({ linkStatus: 'unknown', baseUrl: null });
  useDiscoveryStore.setState({ status: 'unknown', config: null });
  useConnectivityStore.setState({ state: { kind: 'local_offline' } });
  useSessionStore.setState({ session: null, mk: null });
});

describe('degraded engine stop (spec §5.2)', () => {
  it('canRunCycle is false while degraded — no cycle work happens', async () => {
    await setAuthDegraded(true);
    let drained = false;
    _setPushTransport(async () => {
      drained = true;
      throw new Error('unreachable');
    });
    const db = getClientDataDb();
    await db.personas.put({ id: 'p1', name: 'v1', updatedAt: 1 } as never);
    await addOutbox('personas', 'p1', 'upsert');

    await runSyncCycle();

    expect(drained).toBe(false);
  });

  it('isClass2Allowed is false while degraded (disable-over-hide upstream)', async () => {
    await setAuthDegraded(true);
    expect(isClass2Allowed()).toBe(false);
  });

  it('boot re-arms the latch from the persisted attention', async () => {
    await setAttention({ kind: 'auth_degraded' });
    _resetAuthDegradeForTests();
    await armAuthDegradeFromBoot();
    expect(isAuthDegraded()).toBe(true);
  });

  it('a background-origin push refusal degrades without destroying the session', async () => {
    // Every fetch — the push AND the auth-origin refresh — definitively refuses.
    // A `'user'` origin would `closeAndForget` (session → null) and never degrade;
    // proving the session SURVIVES while the latch sets is proving the worker's
    // push carried `origin: 'background'` end-to-end through `apiFetch`.
    const original = globalThis.fetch;
    globalThis.fetch = (async () => refusalResponse()) as typeof fetch;
    try {
      const db = getClientDataDb();
      await db.personas.put({ id: 'p1', name: 'v1', updatedAt: 1 } as never);
      await addOutbox('personas', 'p1', 'upsert');

      await expect(drainOutbox()).rejects.toThrow();

      expect(useSessionStore.getState().session).not.toBeNull();
      expect(isAuthDegraded()).toBe(true);
    } finally {
      globalThis.fetch = original;
    }
  });
});
