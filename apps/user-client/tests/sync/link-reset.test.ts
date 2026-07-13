// apps/user-client/tests/sync/link-reset.test.ts
// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { getLinkedAccount } from '@chatsundere/crypto';
import type { LinkedAccountRow } from '@chatsundere/crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { resetEngineStateForNewLink } from '../../src/sync/link-reset.js';
import { getSyncState } from '../../src/sync/watermark.js';

// The crypto IDB connection is opaque here — it is only ever passed straight
// into the mocked `getLinkedAccount` below — so a dummy value is enough.
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

describe('resetEngineStateForNewLink', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
    await openClientDataDb();
    mockedGetLinkedAccount.mockReset();
    mockedGetLinkedAccount.mockResolvedValue(null);
  });

  it('clears syncRows, syncOutbox, and resets state to a fresh-link posture', async () => {
    const db = getClientDataDb();
    await db.syncRows.put({ collection: 'chats', key: 'c1', rev: 7, ciphertextHash: 'h' });
    await db.syncOutbox.add({ collection: 'chats', key: 'c1', op: 'upsert', enqueuedAt: 1 });
    await db.syncState.put({
      id: 'state',
      epoch: 'old-epoch',
      watermarkRev: 99,
      lastSyncAt: 123,
      pulling: null,
      attention: { kind: 'record_too_large' },
    });

    await resetEngineStateForNewLink();

    expect(await db.syncRows.count()).toBe(0);
    expect(await db.syncOutbox.count()).toBe(0);
    const state = await getSyncState();
    expect(state.watermarkRev).toBe(0);
    expect(state.epoch).toBeNull();
    expect(state.attention).toBeNull();
    expect(state.lastSyncAt).toBeNull();
    expect(state.backfillPending).toBe(true);
    expect(state.backfillTotal).toBeNull();
    expect(state.backfillDone).toBeNull();
  });

  it('clears a tamper attention wholesale (a relink is a legitimate reset, spec 2026-07-13 §3.1)', async () => {
    const db = getClientDataDb();
    await db.syncState.put({
      id: 'state',
      epoch: 'old-epoch',
      watermarkRev: 99,
      lastSyncAt: 123,
      pulling: null,
      attention: { kind: 'tamper' },
    });

    await resetEngineStateForNewLink();

    expect((await getSyncState()).attention).toBeNull();
  });

  it('is idempotent on a fresh database (first-ever link costs nothing)', async () => {
    await resetEngineStateForNewLink();
    const state = await getSyncState();
    expect(state.backfillPending).toBe(true);
    expect(state.watermarkRev).toBe(0);
  });

  it('stamps linkedServerUserId from the currently linked account (Task 4)', async () => {
    mockedGetLinkedAccount.mockResolvedValue(linkedAccountRow('server-user-42'));

    await resetEngineStateForNewLink();

    const state = await getSyncState();
    expect(state.linkedServerUserId).toBe('server-user-42');
  });

  it('leaves linkedServerUserId undefined when no account is linked', async () => {
    await resetEngineStateForNewLink();

    const state = await getSyncState();
    expect(state.linkedServerUserId).toBeUndefined();
  });
});
