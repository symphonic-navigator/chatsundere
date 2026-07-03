// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { useAccountLinkStore, useConnectivityStore, useSessionStore } from '@chatsundere/ui-shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SyncOutboxRow } from '../../src/boot/client-data-db.js';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import {
  SyncOfflineError,
  enqueueSync,
  mutateSynced,
  setImmediateDrain,
} from '../../src/sync/enqueue.js';

/** Seed a linked + online + unlocked account (Class-2 allowed). */
function seedLinkedOnline(): void {
  useAccountLinkStore.setState({ linkStatus: 'linked', baseUrl: 'https://server.example' });
  useConnectivityStore.setState({ state: { kind: 'linked_online' } });
  useSessionStore.setState({ session: { accessToken: 'tok' } as never, mk: {} as never });
}

async function outboxRows(): Promise<SyncOutboxRow[]> {
  return getClientDataDb().syncOutbox.toArray();
}

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
  // Default: a no-op drain, re-registered per test so module state is clean.
  setImmediateDrain(async () => undefined);
});

afterEach(async () => {
  await _resetClientDataDbForTests();
  useAccountLinkStore.setState({ linkStatus: 'unknown', baseUrl: null });
  useConnectivityStore.setState({ state: { kind: 'local_offline' } });
  useSessionStore.setState({ session: null, mk: null });
});

describe('enqueueSync', () => {
  it('writes an outbox row inside the caller transaction', async () => {
    const db = getClientDataDb();
    await db.transaction('rw', db.syncOutbox, async (tx) => {
      enqueueSync(tx, 'personas', 'persona-1', 'upsert');
    });

    const rows = await outboxRows();
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row).toMatchObject({ collection: 'personas', key: 'persona-1', op: 'upsert' });
    expect(typeof row?.enqueuedAt).toBe('number');
    expect(typeof row?.seq).toBe('number'); // auto-increment assigned
  });

  it('rolls back the outbox row when the caller transaction aborts', async () => {
    const db = getClientDataDb();
    await expect(
      db.transaction('rw', db.syncOutbox, async (tx) => {
        enqueueSync(tx, 'chats', 'chat-1', 'delete');
        throw new Error('caller aborted');
      }),
    ).rejects.toThrow('caller aborted');

    expect(await outboxRows()).toHaveLength(0);
  });
});

describe('mutateSynced — local-only passthrough (§5)', () => {
  it('writes locally with no outbox row and no drain, even when "offline"', async () => {
    useAccountLinkStore.setState({ linkStatus: 'local-only', baseUrl: null });
    useConnectivityStore.setState({ state: { kind: 'local_offline' } });
    const drain = vi.fn(async () => undefined);
    setImmediateDrain(drain);

    await mutateSynced({
      collection: 'personas',
      key: 'p1',
      tables: ['personas'],
      write: async (tx) => {
        await tx.table('personas').put({ id: 'p1', name: 'Local' });
      },
    });

    expect(await getClientDataDb().personas.get('p1')).toMatchObject({ id: 'p1' });
    expect(await outboxRows()).toHaveLength(0);
    expect(drain).not.toHaveBeenCalled();
  });
});

describe('mutateSynced — linked (§5)', () => {
  it('commits the local write and the outbox row atomically, then awaits the drain once', async () => {
    seedLinkedOnline();
    const drain = vi.fn(async () => undefined);
    setImmediateDrain(drain);

    await mutateSynced({
      collection: 'personas',
      key: 'p1',
      tables: ['personas'],
      write: async (tx) => {
        await tx.table('personas').put({ id: 'p1', name: 'Synced' });
      },
    });

    expect(await getClientDataDb().personas.get('p1')).toMatchObject({ id: 'p1' });
    const rows = await outboxRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ collection: 'personas', key: 'p1', op: 'upsert' });

    expect(drain).toHaveBeenCalledTimes(1);
    expect(drain).toHaveBeenCalledWith({ collection: 'personas', key: 'p1' });
  });

  it('defaults op to upsert and passes an explicit delete through', async () => {
    seedLinkedOnline();
    setImmediateDrain(async () => undefined);

    await mutateSynced({
      collection: 'chats',
      key: 'c1',
      op: 'delete',
      tables: ['chats'],
      write: async (tx) => {
        await tx.table('chats').delete('c1');
      },
    });

    const rows = await outboxRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.op).toBe('delete');
  });

  it('leaves neither the local row nor the outbox row when the write aborts', async () => {
    seedLinkedOnline();
    const drain = vi.fn(async () => undefined);
    setImmediateDrain(drain);

    await expect(
      mutateSynced({
        collection: 'personas',
        key: 'p1',
        tables: ['personas'],
        write: async (tx) => {
          await tx.table('personas').put({ id: 'p1', name: 'Doomed' });
          throw new Error('write blew up');
        },
      }),
    ).rejects.toThrow('write blew up');

    expect(await getClientDataDb().personas.get('p1')).toBeUndefined();
    expect(await outboxRows()).toHaveLength(0);
    expect(drain).not.toHaveBeenCalled();
  });

  it('throws SyncOfflineError and writes nothing when Class-2 is disallowed', async () => {
    seedLinkedOnline();
    useConnectivityStore.setState({ state: { kind: 'server_unreachable' } });
    const drain = vi.fn(async () => undefined);
    setImmediateDrain(drain);

    await expect(
      mutateSynced({
        collection: 'personas',
        key: 'p1',
        tables: ['personas'],
        write: async (tx) => {
          await tx.table('personas').put({ id: 'p1', name: 'Never' });
        },
      }),
    ).rejects.toBeInstanceOf(SyncOfflineError);

    expect(await getClientDataDb().personas.get('p1')).toBeUndefined();
    expect(await outboxRows()).toHaveLength(0);
    expect(drain).not.toHaveBeenCalled();
  });

  it('propagates a drain rejection to the caller (still-mounted late failure path)', async () => {
    seedLinkedOnline();
    setImmediateDrain(async () => {
      throw new Error('drain failed');
    });

    await expect(
      mutateSynced({
        collection: 'personas',
        key: 'p1',
        tables: ['personas'],
        write: async (tx) => {
          await tx.table('personas').put({ id: 'p1', name: 'Committed' });
        },
      }),
    ).rejects.toThrow('drain failed');

    // The write and outbox row still committed — the drain runs after the tx.
    expect(await getClientDataDb().personas.get('p1')).toMatchObject({ id: 'p1' });
    expect(await outboxRows()).toHaveLength(1);
  });
});
