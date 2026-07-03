// apps/user-client/tests/sync/link-reset.test.ts
// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { resetEngineStateForNewLink } from '../../src/sync/link-reset.js';
import { getSyncState } from '../../src/sync/watermark.js';

describe('resetEngineStateForNewLink', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
    await openClientDataDb();
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

  it('is idempotent on a fresh database (first-ever link costs nothing)', async () => {
    await resetEngineStateForNewLink();
    const state = await getSyncState();
    expect(state.backfillPending).toBe(true);
    expect(state.watermarkRev).toBe(0);
  });
});
