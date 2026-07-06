// apps/user-client/tests/sync/server-identity.test.ts
// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { getLinkedAccount } from '@chatsundere/crypto';
import type { LinkedAccountRow } from '@chatsundere/crypto';
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
import { getSyncState } from '../../src/sync/watermark.js';
import {
  _resetWorkerForTests,
  _setPullLoop,
  _setPushTransport,
  enforceServerIdentity,
  runSyncCycle,
} from '../../src/sync/worker.js';

// The crypto IDB connection is opaque to `enforceServerIdentity` — it is only
// ever passed straight into the mocked `getLinkedAccount` below — so a dummy
// value is enough; no real connection needs opening in this test file.
vi.mock('../../src/boot/open-db.js', () => ({
  getDb: vi.fn(() => ({}) as unknown as IDBDatabase),
}));

vi.mock('@chatsundere/crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@chatsundere/crypto')>();
  return { ...actual, getLinkedAccount: vi.fn(async () => null) };
});

const mockedGetLinkedAccount = vi.mocked(getLinkedAccount);

/** A minimally-populated `LinkedAccountRow` — only `server_user_id` matters here. */
function linkedAccountRow(serverUserId: string): LinkedAccountRow {
  return {
    server_user_id: serverUserId,
    base_url: 'https://server.example',
    issuer_label: null,
    role: 'user',
    wrapped_mk_opaque_ciphertext: new Uint8Array(),
    wrapped_mk_opaque_nonce: new Uint8Array(),
    wrapped_mk_opaque_aad: new Uint8Array(),
    wrapped_mk_opaque_integrity: new Uint8Array(),
    linked_at: new Date(),
  };
}

/** Stamp the sync-state singleton's `linkedServerUserId` directly. */
async function stampIdentity(id: string | undefined): Promise<void> {
  await getSyncState();
  await getClientDataDb().syncState.update('state', { linkedServerUserId: id });
}

describe('enforceServerIdentity — cycle-start server-switch guard (Task 4)', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
    await openClientDataDb();
    mockedGetLinkedAccount.mockReset();
    mockedGetLinkedAccount.mockResolvedValue(null);
  });

  it('forces a reset when the stamped identity differs from the currently linked account', async () => {
    const db = getClientDataDb();
    await stampIdentity('A');
    await db.syncRows.put({ collection: 'chats', key: 'c1', rev: 3, ciphertextHash: 'h' });
    await db.syncOutbox.add({ collection: 'chats', key: 'c1', op: 'upsert', enqueuedAt: 1 });
    mockedGetLinkedAccount.mockResolvedValue(linkedAccountRow('B'));

    await enforceServerIdentity();

    expect(await db.syncRows.count()).toBe(0);
    expect(await db.syncOutbox.count()).toBe(0);
    const state = await getSyncState();
    expect(state.backfillPending).toBe(true);
    expect(state.linkedServerUserId).toBe('B'); // re-stamped to the new identity
  });

  it('does NOT trigger on a first-ever link (nothing stamped yet)', async () => {
    const db = getClientDataDb();
    await db.syncRows.put({ collection: 'chats', key: 'c1', rev: 3, ciphertextHash: 'h' });
    mockedGetLinkedAccount.mockResolvedValue(linkedAccountRow('X'));

    await enforceServerIdentity();

    expect(await db.syncRows.count()).toBe(1); // untouched — no data loss on a first link
    const state = await getSyncState();
    expect(state.linkedServerUserId).toBeUndefined();
  });

  it('is a no-op when the linked identity is unchanged', async () => {
    const db = getClientDataDb();
    await stampIdentity('A');
    await db.syncRows.put({ collection: 'chats', key: 'c1', rev: 3, ciphertextHash: 'h' });
    mockedGetLinkedAccount.mockResolvedValue(linkedAccountRow('A'));

    await enforceServerIdentity();

    expect(await db.syncRows.count()).toBe(1);
    const state = await getSyncState();
    expect(state.linkedServerUserId).toBe('A');
  });

  describe('wired into runSyncCycle', () => {
    afterEach(() => {
      _resetWorkerForTests();
      useAccountLinkStore.setState({ linkStatus: 'unknown', baseUrl: null });
      useDiscoveryStore.setState({ status: 'unknown', config: null });
      useConnectivityStore.setState({ state: { kind: 'local_offline' } });
      useSessionStore.setState({ session: null, mk: null });
    });

    it('resets before the drain when the cycle detects a server switch', async () => {
      useAccountLinkStore.setState({ linkStatus: 'linked', baseUrl: 'https://server.example' });
      useDiscoveryStore.setState({
        status: 'ok',
        // biome-ignore lint/suspicious/noExplicitAny: partial store shape for the test
        config: { syncUrl: 'https://sync.example', features: ['sync'] } as any,
      });
      useConnectivityStore.setState({ state: { kind: 'linked_online' } });
      useSessionStore.setState({ session: { accessToken: 'tok' } as never, mk: {} as never });

      const db = getClientDataDb();
      await stampIdentity('A');
      await db.syncRows.put({ collection: 'chats', key: 'stale', rev: 1, ciphertextHash: 'h' });
      mockedGetLinkedAccount.mockResolvedValue(linkedAccountRow('B'));
      const push = vi.fn(async () => ({ head: 0, epoch: 'E1', results: [] }));
      _setPushTransport(push);
      // No outbox entries this cycle → the drain never pushes, so `head` stays
      // null and the reader-path pull would otherwise fire for real; stub it.
      _setPullLoop(vi.fn(async () => undefined));

      await runSyncCycle();

      expect(await db.syncRows.count()).toBe(0); // the stale row is gone — reset ran first
      const state = await getSyncState();
      expect(state.linkedServerUserId).toBe('B');
    });
  });
});
