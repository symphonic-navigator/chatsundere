// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { getSyncState } from '../../src/sync/watermark.js';

describe('getSyncState heal', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
    await openClientDataDb();
  });

  it('heals a legacy row missing the backfill fields', async () => {
    const db = getClientDataDb();
    // A pre-backfill-feature row: only the fields that existed then.
    await db.syncState.add({ id: 'state', epoch: 'e1', watermarkRev: 5 } as never);
    const state = await getSyncState();
    expect(state.backfillPending).toBe(false); // healed, not undefined
    expect(state.backfillTotal).toBeNull();
    expect(state.backfillDone).toBeNull();
    // persisted, not just returned:
    const raw = await db.syncState.get('state');
    expect(raw?.backfillPending).toBe(false);
    // untouched fields preserved:
    expect(state.epoch).toBe('e1');
    expect(state.watermarkRev).toBe(5);
  });

  it('leaves a complete row unchanged', async () => {
    const db = getClientDataDb();
    await db.syncState.put({ ...(await getSyncState()), backfillPending: true });
    const state = await getSyncState();
    expect(state.backfillPending).toBe(true);
  });
});
