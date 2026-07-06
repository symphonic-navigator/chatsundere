// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db.js';
import {
  advanceWatermark,
  checkEpoch,
  getSyncState,
  isRecovering,
  setAttention,
  setPulling,
  setRecovering,
  subscribeRecovering,
} from '../../src/sync/watermark.js';

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
});
afterEach(async () => {
  await _resetClientDataDbForTests();
  setRecovering(false);
});

describe('getSyncState', () => {
  it('lazily creates the singleton with defaults', async () => {
    const state = await getSyncState();
    expect(state).toEqual({
      id: 'state',
      epoch: null,
      watermarkRev: 0,
      lastSyncAt: null,
      pulling: null,
      attention: null,
      backfillPending: false,
      backfillTotal: null,
      backfillDone: null,
      suppressedRevs: {},
    });
  });

  it('returns the same singleton on repeat access', async () => {
    await getSyncState();
    await advanceWatermark(4);
    const again = await getSyncState();
    expect(again.watermarkRev).toBe(4);
  });
});

describe('advanceWatermark — monotone (M-7)', () => {
  it('advances forward', async () => {
    await advanceWatermark(10);
    expect((await getSyncState()).watermarkRev).toBe(10);
  });

  it('never regresses on a lower rev', async () => {
    await advanceWatermark(10);
    await advanceWatermark(3);
    expect((await getSyncState()).watermarkRev).toBe(10);
  });

  it('takes max across interleaved advances', async () => {
    await advanceWatermark(5);
    await advanceWatermark(12);
    await advanceWatermark(7);
    expect((await getSyncState()).watermarkRev).toBe(12);
  });
});

describe('setPulling / setAttention', () => {
  it('sets and clears the pulling progress state', async () => {
    await setPulling({ pages: 3, startedAt: 111 });
    expect((await getSyncState()).pulling).toEqual({ pages: 3, startedAt: 111 });
    await setPulling(null);
    expect((await getSyncState()).pulling).toBeNull();
  });

  it('sets and clears the attention state', async () => {
    await setAttention({ kind: 'recovery_paused' });
    expect((await getSyncState()).attention).toEqual({ kind: 'recovery_paused' });
    await setAttention(null);
    expect((await getSyncState()).attention).toBeNull();
  });
});

describe('checkEpoch (§8)', () => {
  it('persists the epoch on first sync', async () => {
    expect(await checkEpoch('epoch-A')).toBe('first');
    expect((await getSyncState()).epoch).toBe('epoch-A');
  });

  it('reports ok when the epoch matches', async () => {
    await checkEpoch('epoch-A');
    expect(await checkEpoch('epoch-A')).toBe('ok');
  });

  it('reports mismatch when the epoch differs', async () => {
    await checkEpoch('epoch-A');
    expect(await checkEpoch('epoch-B')).toBe('mismatch');
    // The persisted epoch is unchanged until recovery persists the new one.
    expect((await getSyncState()).epoch).toBe('epoch-A');
  });
});

describe('recovery flag', () => {
  it('is false by default and toggles with notification', () => {
    expect(isRecovering()).toBe(false);
    const seen: boolean[] = [];
    const unsub = subscribeRecovering((v) => seen.push(v));
    setRecovering(true);
    expect(isRecovering()).toBe(true);
    setRecovering(true); // no-op, no duplicate notify
    setRecovering(false);
    unsub();
    setRecovering(true); // not observed after unsubscribe
    expect(seen).toEqual([true, false]);
  });
});
