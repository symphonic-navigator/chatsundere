// SPDX-License-Identifier: AGPL-3.0-only
import { type LinkedAccountRow, openLocalDb, putLinkedAccount } from '@chatsundere/crypto';
import { useAccountLinkStore } from '@chatsundere/ui-shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db.js';

const probeSpy = vi.hoisted(() => vi.fn());
vi.mock('@chatsundere/ui-shared', async (importOriginal) => {
  const original = await importOriginal<typeof import('@chatsundere/ui-shared')>();
  return { ...original, maybeProbeLinkedServer: probeSpy };
});

const dbHolder = vi.hoisted(() => ({ db: null as IDBDatabase | null }));
vi.mock('../../src/boot/open-db.js', () => ({
  getDb: () => {
    if (!dbHolder.db) throw new Error('test db not opened');
    return dbHolder.db;
  },
}));

import { initServerFoundation } from '../../src/boot/server-foundation.js';

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

describe('initServerFoundation', () => {
  beforeEach(async () => {
    probeSpy.mockClear();
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
    // Production boot opens the client-data DB (via openDb) before
    // initServerFoundation; armAuthDegradeFromBoot (§5.2) reads its sync state,
    // so the test must open it too.
    await _resetClientDataDbForTests();
    await openClientDataDb();
  });

  it('populates local-only and still fires the probe attempt (which no-ops)', async () => {
    await initServerFoundation();
    expect(useAccountLinkStore.getState().linkStatus).toBe('local-only');
    expect(probeSpy).toHaveBeenCalledTimes(1);
  });

  it('populates linked state from the IDB row, then probes', async () => {
    const db = dbHolder.db;
    if (!db) throw new Error('unreachable');
    await putLinkedAccount(db, linkedRowFixture());
    await initServerFoundation();
    const s = useAccountLinkStore.getState();
    expect(s.linkStatus).toBe('linked');
    expect(s.baseUrl).toBe('https://chatsundere.example.org');
    expect(probeSpy).toHaveBeenCalledTimes(1);
  });
});
