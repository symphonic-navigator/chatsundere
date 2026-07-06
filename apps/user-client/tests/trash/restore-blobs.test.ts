// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
// Runs in the NODE environment (like `apply-blob-heal.test.ts`): jsdom's `Blob`
// does not survive an IndexedDB structured-clone round-trip, so the byte-bearing
// restore path — which reads the snapshot blob back across the trash table —
// needs Node's real `Blob` for the `instanceof Blob` gate to hold.
import 'fake-indexeddb/auto';
import type { SyncCollection } from '@chatsundere/shared-types';
import { useAccountLinkStore, useConnectivityStore, useSessionStore } from '@chatsundere/ui-shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SyncOutboxRow, TrashRow } from '../../src/boot/client-data-db.js';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { setImmediateDrain } from '../../src/sync/enqueue.js';
import { _resetTriggersForTests, _setTriggerCycle } from '../../src/sync/triggers.js';
import { restoreCard } from '../../src/trash/trash-repo.js';

// ── Store helpers ────────────────────────────────────────────────────────────

/** Linked + reachable + unlocked → the restore enqueues into the sync outbox. */
function setOnline(): void {
  useAccountLinkStore.setState({ linkStatus: 'linked', baseUrl: 'https://server.example' });
  useConnectivityStore.setState({ state: { kind: 'linked_online' } });
  useSessionStore.setState({ mk: { key: 'fake-mk' } as never });
}

// ── Trash seeder ─────────────────────────────────────────────────────────────

const BLOB_ID = 'blob-artefact-X';

function makeTrashRow(
  collection: SyncCollection,
  key: string,
  row: unknown,
  parentRef: { field: string; id: string } | null,
  entityKind: TrashRow['entityKind'],
  rootGroup: string,
): TrashRow {
  return {
    id: `${collection}:${key}`,
    collection,
    key,
    row,
    deletedAt: 1,
    purgeAt: 1,
    entityKind,
    rootGroup,
    parentRef,
  };
}

/** Seed a single-member artefact card whose blob field carries bytes + a ref. */
async function seedArtefactCard(opts: { withBytes: boolean }): Promise<void> {
  const db = getClientDataDb();
  const blob = opts.withBytes ? new Blob([new Uint8Array([1, 2, 3, 4])]) : undefined;
  const row: Record<string, unknown> = {
    id: 'a1',
    chatId: null,
    blobRef: { blobId: BLOB_ID, bytes: 32 },
  };
  if (blob !== undefined) row.blob = blob;
  await db.trash.bulkPut([makeTrashRow('artefacts', 'a1', row, null, 'chatChild', 'artefacts:a1')]);
  await db.deadKeys.bulkPut([
    { id: 'artefacts:a1', collection: 'artefacts', key: 'a1', diedAt: 1 },
  ]);
}

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
  _setTriggerCycle(async () => undefined);
  setImmediateDrain(async () => undefined);
});

afterEach(async () => {
  _resetTriggersForTests();
  setImmediateDrain(async () => undefined);
  await _resetClientDataDbForTests();
  useAccountLinkStore.setState({ linkStatus: 'unknown', baseUrl: null });
  useConnectivityStore.setState({ state: { kind: 'local_offline' } });
  useSessionStore.setState({ mk: null });
});

// ── restoreCard — blob channel re-establishment (audit #6) ───────────────────

describe('restoreCard — re-establishes the blob channel (audit #6)', () => {
  it('enqueues a blob-put under the PRESERVED blobId for a byte-bearing restored ref', async () => {
    setOnline();
    await seedArtefactCard({ withBytes: true });
    const db = getClientDataDb();

    await restoreCard('artefacts:a1');

    // The restored artefact minted a fresh id but PRESERVED the blobId on its ref.
    const artefacts = await db.artefacts.toArray();
    expect(artefacts.length).toBe(1);
    const restored = artefacts[0] as unknown as Record<string, unknown>;
    expect(restored.id).not.toBe('a1');
    expect((restored.blobRef as { blobId: string }).blobId).toBe(BLOB_ID);

    // A repair blob-put for the PRESERVED id at the artefact's NEW key.
    const outbox = (await db.syncOutbox.toArray()) as SyncOutboxRow[];
    const puts = outbox.filter((r) => r.op === 'blob-put' && r.blobId === BLOB_ID);
    expect(puts.length).toBe(1);
    const put = puts[0];
    if (put === undefined) throw new Error('missing blob-put');
    expect(put.collection).toBe('artefacts');
    expect(put.key).toBe(restored.id);
  });

  it('cancels a pending blob-delete for a revived ref (restore before drain)', async () => {
    setOnline();
    await seedArtefactCard({ withBytes: true });
    const db = getClientDataDb();

    // A blob-delete for the same id is still queued (the delete has NOT drained).
    await db.syncOutbox.add({
      collection: 'artefacts',
      key: 'a1',
      op: 'blob-delete',
      blobId: BLOB_ID,
      enqueuedAt: 1,
    } as SyncOutboxRow);

    await restoreCard('artefacts:a1');

    const outbox = (await db.syncOutbox.toArray()) as SyncOutboxRow[];
    const deletes = outbox.filter((r) => r.op === 'blob-delete' && r.blobId === BLOB_ID);
    expect(deletes.length).toBe(0);
  });

  it('enqueues nothing for a ref without local bytes (lazy original never fetched)', async () => {
    setOnline();
    await seedArtefactCard({ withBytes: false });
    const db = getClientDataDb();

    await restoreCard('artefacts:a1');

    const outbox = (await db.syncOutbox.toArray()) as SyncOutboxRow[];
    const puts = outbox.filter((r) => r.op === 'blob-put');
    expect(puts.length).toBe(0);
  });
});
