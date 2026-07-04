// apps/user-client/tests/lib/decouple-device.test.ts
// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import {
  type LinkedAccountRow,
  getLinkedAccount,
  openLocalDb,
  putLinkedAccount,
} from '@chatsundere/crypto';
import { useAccountLinkStore } from '@chatsundere/ui-shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';

// Mirrors the established pattern in tests/boot/server-foundation.test.ts: the
// module-level `getDb()` singleton in open-db.js has no test-reset hook, so
// mock it to hand back a freshly opened crypto IDB each test instead.
const dbHolder = vi.hoisted(() => ({ db: null as IDBDatabase | null }));
vi.mock('../../src/boot/open-db.js', () => ({
  getDb: () => {
    if (!dbHolder.db) throw new Error('test db not opened');
    return dbHolder.db;
  },
}));

const logoutSpy = vi.hoisted(() => vi.fn());
vi.mock('../../src/lib/auth-logout.js', () => ({ logoutCurrentSession: logoutSpy }));

const { decoupleDevice } = await import('../../src/lib/decouple-device.js');

function linkedRowFixture(): LinkedAccountRow {
  return {
    server_user_id: '0197fead-0000-7000-8000-000000000002',
    base_url: 'https://chatsundere.example.org',
    issuer_label: null,
    role: 'user',
    wrapped_mk_opaque_ciphertext: new Uint8Array([1]),
    wrapped_mk_opaque_nonce: new Uint8Array([2]),
    wrapped_mk_opaque_aad: new Uint8Array([3]),
    wrapped_mk_opaque_integrity: new Uint8Array([4]),
    linked_at: new Date('2026-07-01T00:00:00Z'),
  };
}

describe('decoupleDevice', () => {
  beforeEach(async () => {
    logoutSpy.mockReset();
    useAccountLinkStore.setState({
      linkStatus: 'unknown',
      baseUrl: null,
      issuerLabel: null,
      role: null,
    });

    dbHolder.db?.close();
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase('chatsundere');
      req.onsuccess = () => resolve();
      req.onerror = () => resolve();
      req.onblocked = () => resolve();
    });
    dbHolder.db = await openLocalDb();
    await putLinkedAccount(dbHolder.db, linkedRowFixture());

    await _resetClientDataDbForTests();
    await openClientDataDb();
    const db = getClientDataDb();
    await db.personas.put({ id: 'p1', name: 'Fable' } as never);
    await db.syncRows.put({ collection: 'personas', key: 'p1', rev: 3, ciphertextHash: 'h' });
    await db.syncOutbox.add({ collection: 'personas', key: 'p1', op: 'upsert', enqueuedAt: 1 });
    await db.syncState.put({
      id: 'state',
      epoch: 'e',
      watermarkRev: 9,
      lastSyncAt: null,
      pulling: null,
      attention: null,
      backfillPending: true,
      backfillTotal: 2,
      backfillDone: 1,
    });
  });

  it('happy path: revokes the session, unlinks, flips local-only, resets transfer-state, keeps user data', async () => {
    logoutSpy.mockResolvedValue(true);

    const result = await decoupleDevice();

    expect(result).toEqual({ sessionRevoked: true });
    expect(logoutSpy).toHaveBeenCalledTimes(1);

    const db = dbHolder.db;
    if (!db) throw new Error('unreachable');
    expect(await getLinkedAccount(db)).toBeNull();

    const linkState = useAccountLinkStore.getState();
    expect(linkState.linkStatus).toBe('local-only');
    expect(linkState.baseUrl).toBeNull();
    expect(linkState.issuerLabel).toBeNull();
    expect(linkState.role).toBeNull();

    const clientDb = getClientDataDb();
    expect(await clientDb.syncRows.count()).toBe(0);
    expect(await clientDb.syncOutbox.count()).toBe(0);
    const s = await clientDb.syncState.get('state');
    expect(s).toMatchObject({
      epoch: null,
      watermarkRev: 0,
      backfillPending: false,
      backfillTotal: null,
      backfillDone: null,
    });

    // User data is untouched by the decouple sequence.
    expect(await clientDb.personas.get('p1')).toMatchObject({ id: 'p1', name: 'Fable' });
  });

  it('failure path: still unlinks and resets even when the remote revoke fails', async () => {
    logoutSpy.mockResolvedValue(false);

    const result = await decoupleDevice();

    expect(result).toEqual({ sessionRevoked: false });

    const db = dbHolder.db;
    if (!db) throw new Error('unreachable');
    expect(await getLinkedAccount(db)).toBeNull();

    expect(useAccountLinkStore.getState().linkStatus).toBe('local-only');

    const clientDb = getClientDataDb();
    expect(await clientDb.syncRows.count()).toBe(0);
    expect(await clientDb.syncOutbox.count()).toBe(0);
    const s = await clientDb.syncState.get('state');
    expect(s).toMatchObject({ backfillPending: false });

    expect(await clientDb.personas.get('p1')).toMatchObject({ id: 'p1', name: 'Fable' });
  });
});
