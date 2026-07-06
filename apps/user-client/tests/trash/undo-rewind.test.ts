// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { toBase64Url } from '@chatsundere/crypto';
import type { SyncPulledRecord } from '@chatsundere/shared-types';
import { useAccountLinkStore, useConnectivityStore, useSessionStore } from '@chatsundere/ui-shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ChatRow } from '../../src/boot/client-data-db.js';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { _resetApplyForTests, _setApplyOpenRecord, applyRecord } from '../../src/sync/apply.js';
import { setImmediateDrain } from '../../src/sync/enqueue.js';
import { _resetTriggersForTests, _setTriggerCycle } from '../../src/sync/triggers.js';
import { advanceWatermark, getSyncState, recordSuppressedRev } from '../../src/sync/watermark.js';
import { softDelete } from '../../src/trash/delete-flow.js';

// ── Store helpers ────────────────────────────────────────────────────────────

/** Linked + reachable + unlocked → Class-2 writes are allowed, and `mk` is present for apply. */
function setOnline(): void {
  useAccountLinkStore.setState({ linkStatus: 'linked', baseUrl: 'https://server.example' });
  useConnectivityStore.setState({ state: { kind: 'linked_online' } });
  useSessionStore.setState({ mk: { key: 'fake-mk' } as never });
}

// ── Row seeder ───────────────────────────────────────────────────────────────

async function seedChat(id: string, personaId: string, updatedAt: number): Promise<void> {
  await getClientDataDb().chats.add({
    id,
    personaId,
    title: 'local original',
    resolvedMindspaceId: 'ms-1',
    createdAt: 1,
    updatedAt,
    lastMessageAt: 1,
    bookmarkedMessageCount: 0,
    draftInput: '',
    libraryIds: [],
  } as unknown as ChatRow);
}

/** A minimal pulled upsert wire record; the open override supplies the decrypted row. */
function pulledUpsert(collection: string, key: string, rev: number): SyncPulledRecord {
  return {
    blindId: toBase64Url(new TextEncoder().encode(`bid:${collection}:${key}`)),
    collection: collection as SyncPulledRecord['collection'],
    rev,
    deleted: false,
    nonce: toBase64Url(new Uint8Array([1, 2, 3])),
    ciphertext: toBase64Url(new Uint8Array([4, 5, 6])),
  };
}

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
  _setTriggerCycle(async () => undefined);
  setImmediateDrain(async () => undefined); // drain is a no-op; we drive apply by hand
});

afterEach(async () => {
  _resetApplyForTests();
  _resetTriggersForTests();
  setImmediateDrain(async () => undefined);
  await _resetClientDataDbForTests();
  useAccountLinkStore.setState({ linkStatus: 'unknown', baseUrl: null });
  useConnectivityStore.setState({ state: { kind: 'local_offline' } });
  useSessionStore.setState({ mk: null });
});

// ── Audit #5: Undo rewinds the watermark below suppressed revs ────────────────

describe('softDelete restore — Undo rewinds the watermark below suppressed revs (#5)', () => {
  it('rewinds the watermark below the suppressed rev on in-place restore', async () => {
    setOnline();
    await seedChat('c1', 'p1', 1);
    // The pull loop had already paged past rev 9 — the watermark sits at 12.
    await advanceWatermark(12);

    const handle = await softDelete('chats', 'c1');
    // A foreign edit at rev 9 was pulled while our delete was pending → suppressed.
    await recordSuppressedRev('chats', 'c1', 9);

    await handle.restore();

    const state = await getSyncState();
    // Rewound to one below the suppressed rev so the next pull re-delivers it.
    expect(state.watermarkRev).toBe(8);
    // The suppressed-rev record was consumed by the rewind.
    expect(state.suppressedRevs).not.toHaveProperty('chats:c1');
  });

  it('leaves the watermark alone when nothing was suppressed', async () => {
    setOnline();
    await seedChat('c1', 'p1', 1);
    await advanceWatermark(12);

    const handle = await softDelete('chats', 'c1');
    await handle.restore();

    expect((await getSyncState()).watermarkRev).toBe(12);
  });

  it('re-applies the foreign edit after the rewound pull (end-to-end)', async () => {
    setOnline();
    await seedChat('c1', 'p1', 1);
    await advanceWatermark(12);

    // Pending delete + snapshot, then a suppressed foreign edit at rev 9.
    const handle = await softDelete('chats', 'c1');
    await recordSuppressedRev('chats', 'c1', 9);

    // Undo: the row is restored, the delete cancelled, the watermark rewound.
    await handle.restore();
    expect((await getSyncState()).watermarkRev).toBe(8);

    // The next pull re-serves rev 9. With no pending delete blocking it, normal
    // LWW runs against the restored row: the newer foreign edit wins.
    _setApplyOpenRecord(async () => ({
      id: 'c1',
      personaId: 'p1',
      title: 'foreign edit',
      resolvedMindspaceId: 'ms-1',
      createdAt: 1,
      updatedAt: 9,
      libraryIds: [],
    }));
    const outcome = await applyRecord(pulledUpsert('chats', 'c1', 9));

    expect(outcome).toEqual({ kind: 'resolved', winner: 'pulled' });
    const db = getClientDataDb();
    expect((await db.chats.get('c1'))?.title).toBe('foreign edit');
  });
});
