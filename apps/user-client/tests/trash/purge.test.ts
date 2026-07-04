// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import type { SyncCollection } from '@chatsundere/shared-types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TrashRow } from '../../src/boot/client-data-db.js';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { purgeCard } from '../../src/trash/trash-repo.js';

// ── Trash seeder ─────────────────────────────────────────────────────────────

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

async function seedPersonaCard(): Promise<void> {
  const db = getClientDataDb();
  await db.trash.bulkPut([
    makeTrashRow('personas', 'p1', { id: 'p1', name: 'Fable' }, null, 'persona', 'persona:p1'),
    makeTrashRow(
      'chats',
      'c1',
      { id: 'c1', personaId: 'p1', title: null },
      { field: 'personaId', id: 'p1' },
      'chat',
      'persona:p1',
    ),
    makeTrashRow(
      'messages',
      'm1',
      { id: 'm1', chatId: 'c1' },
      { field: 'chatId', id: 'c1' },
      'chatChild',
      'persona:p1',
    ),
    makeTrashRow(
      'memoryJournal',
      'mem1',
      { id: 'mem1', personaId: 'p1', content: 'remembered' },
      { field: 'personaId', id: 'p1' },
      'memory',
      'persona:p1',
    ),
  ]);
  // A queued local delete for one of the card's keys — must survive purge (I-3).
  await db.syncOutbox.add({ collection: 'chats', key: 'c1', op: 'delete', enqueuedAt: 1 });
  // Durable dead-key markers for all four — must survive purge forever (§3.9).
  await db.deadKeys.bulkPut([
    { id: 'personas:p1', collection: 'personas', key: 'p1', diedAt: 1 },
    { id: 'chats:c1', collection: 'chats', key: 'c1', diedAt: 1 },
    { id: 'messages:m1', collection: 'messages', key: 'm1', diedAt: 1 },
    { id: 'memoryJournal:mem1', collection: 'memoryJournal', key: 'mem1', diedAt: 1 },
  ]);
}

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
});

afterEach(async () => {
  await _resetClientDataDbForTests();
});

// ── purgeCard integration ────────────────────────────────────────────────────

describe('purgeCard — cascade delete of trash snapshots, local-only', () => {
  it('removes the whole card from db.trash but leaves syncOutbox (I-3) and deadKeys (§3.9)', async () => {
    await seedPersonaCard();
    const db = getClientDataDb();

    await purgeCard('personas:p1');

    // All four snapshot rows gone.
    expect(await db.trash.count()).toBe(0);

    // syncOutbox untouched — the queued local delete still present (I-3).
    const outbox = await db.syncOutbox.toArray();
    expect(outbox.length).toBe(1);
    const entry = outbox[0];
    if (entry === undefined) throw new Error('missing outbox entry');
    expect(entry.op).toBe('delete');
    expect(`${entry.collection}:${entry.key}`).toBe('chats:c1');

    // deadKeys untouched — all four markers still present (§3.9).
    expect(await db.deadKeys.count()).toBe(4);
    expect(await db.deadKeys.get('personas:p1')).toBeDefined();
    expect(await db.deadKeys.get('chats:c1')).toBeDefined();
    expect(await db.deadKeys.get('messages:m1')).toBeDefined();
    expect(await db.deadKeys.get('memoryJournal:mem1')).toBeDefined();
  });
});
