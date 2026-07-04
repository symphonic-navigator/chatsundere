// SPDX-License-Identifier: AGPL-3.0-only
import { useAccountLinkStore, useSessionStore } from '@chatsundere/ui-shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import {
  _resetBackfillForTests,
  _setVectorKeysSource,
  armBackfillIfCorpusUnsynced,
} from '../../src/sync/backfill.js';

/**
 * Task 2 (Unit 1b) — the durable rescue for an already-stranded device: a
 * linked device whose pre-existing vault never entered the backfill/outbox
 * flow. The mk guard is unlocked for every case (a fake non-null `mk`,
 * mirroring the sibling backfill suites' `seedLinkedOnline`) so the three
 * cases below isolate the corpus-scan/arm decision itself, not the mk guard.
 */
describe('armBackfillIfCorpusUnsynced', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
    await openClientDataDb();
    _setVectorKeysSource(async () => []);
    useAccountLinkStore.setState({ linkStatus: 'linked' } as never);
    useSessionStore.setState({ session: { accessToken: 'tok' } as never, mk: {} as never });
  });

  afterEach(async () => {
    _resetBackfillForTests();
    await _resetClientDataDbForTests();
    useAccountLinkStore.setState({ linkStatus: 'unknown', baseUrl: null } as never);
    useSessionStore.setState({ session: null, mk: null });
  });

  it('arms when a linked device holds an un-synced row', async () => {
    const db = getClientDataDb();
    // Only the persona should be a candidate — drop the seeded settings
    // singleton (backfill.test.ts/backfill-scenarios.test.ts convention).
    await db.settings.delete(1);
    await db.personas.add({ id: 'p1', name: 'X' } as never); // no syncRows base, no outbox
    await armBackfillIfCorpusUnsynced();
    expect((await db.syncState.get('state'))?.backfillPending).toBe(true);
  });

  it('does not arm a fully-synced linked device', async () => {
    const db = getClientDataDb();
    await db.settings.delete(1);
    await db.personas.add({ id: 'p1', name: 'X' } as never);
    await db.syncRows.put({ collection: 'personas', key: 'p1', rev: 1, ciphertextHash: '' });
    await armBackfillIfCorpusUnsynced();
    expect((await db.syncState.get('state'))?.backfillPending ?? false).toBe(false);
  });

  it('is a no-op when local-only', async () => {
    useAccountLinkStore.setState({ linkStatus: 'local-only' } as never);
    const db = getClientDataDb();
    await db.settings.delete(1);
    await db.personas.add({ id: 'p1', name: 'X' } as never);
    await armBackfillIfCorpusUnsynced();
    expect((await db.syncState.get('state'))?.backfillPending ?? false).toBe(false);
  });

  it('is a no-op when already armed', async () => {
    const db = getClientDataDb();
    await db.settings.delete(1);
    await db.personas.add({ id: 'p1', name: 'X' } as never); // un-synced candidate
    // Sentinel totals that the fresh-arm path would overwrite with null — if
    // they survive the call, the guard returned before re-running the scan.
    await db.syncState.put({
      id: 'state',
      epoch: null,
      watermarkRev: 0,
      lastSyncAt: null,
      pulling: null,
      attention: null,
      backfillPending: true,
      backfillTotal: 5,
      backfillDone: 2,
    });
    await armBackfillIfCorpusUnsynced();
    const state = await db.syncState.get('state');
    expect(state?.backfillPending).toBe(true);
    expect(state?.backfillTotal).toBe(5);
    expect(state?.backfillDone).toBe(2);
  });

  it('is a no-op when mk is null', async () => {
    useSessionStore.setState({ session: null, mk: null });
    const db = getClientDataDb();
    await db.settings.delete(1);
    await db.personas.add({ id: 'p1', name: 'X' } as never); // un-synced candidate
    await armBackfillIfCorpusUnsynced();
    expect((await db.syncState.get('state'))?.backfillPending ?? false).toBe(false);
  });
});
