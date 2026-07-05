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
import { listTrashCards } from '../../src/trash/trash-repo.js';

// ── Trash seeder ─────────────────────────────────────────────────────────────

function makeTrashRow(
  collection: SyncCollection,
  key: string,
  row: unknown,
  parentRef: { field: string; id: string } | null,
  entityKind: TrashRow['entityKind'],
  rootGroup: string,
  deletedAt = 1,
): TrashRow {
  return {
    id: `${collection}:${key}`,
    collection,
    key,
    row,
    deletedAt,
    purgeAt: deletedAt,
    entityKind,
    rootGroup,
    parentRef,
  };
}

/** A trashed persona `p1` with two chats (3 messages each) and one memory. */
async function seedPersonaCard(): Promise<void> {
  const db = getClientDataDb();
  const rows: TrashRow[] = [
    makeTrashRow('personas', 'p1', { id: 'p1', name: 'Fable' }, null, 'persona', 'persona:p1'),
  ];
  for (const c of ['c1', 'c2']) {
    rows.push(
      makeTrashRow(
        'chats',
        c,
        { id: c, personaId: 'p1', title: `Chat ${c}` },
        { field: 'personaId', id: 'p1' },
        'chat',
        'persona:p1',
      ),
    );
    for (let i = 0; i < 3; i++) {
      rows.push(
        makeTrashRow(
          'messages',
          `${c}-m${i}`,
          { id: `${c}-m${i}`, chatId: c },
          { field: 'chatId', id: c },
          'chatChild',
          'persona:p1',
        ),
      );
    }
  }
  rows.push(
    makeTrashRow(
      'memoryJournal',
      'mem1',
      { id: 'mem1', personaId: 'p1', content: 'remembered a fact' },
      { field: 'personaId', id: 'p1' },
      'memory',
      'persona:p1',
    ),
  );
  await db.trash.bulkPut(rows);
}

/** A lone trashed chat whose persona is still LIVE (not in trash). */
async function seedLoneChat(): Promise<void> {
  const db = getClientDataDb();
  await db.trash.bulkPut([
    makeTrashRow(
      'chats',
      'c9',
      { id: 'c9', personaId: 'pLive', title: 'Solo' },
      { field: 'personaId', id: 'pLive' },
      'chat',
      'chats:c9',
    ),
    makeTrashRow(
      'messages',
      'c9-m0',
      { id: 'c9-m0', chatId: 'c9' },
      { field: 'chatId', id: 'c9' },
      'chatChild',
      'chats:c9',
    ),
    makeTrashRow(
      'messages',
      'c9-m1',
      { id: 'c9-m1', chatId: 'c9' },
      { field: 'chatId', id: 'c9' },
      'chatChild',
      'chats:c9',
    ),
  ]);
}

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
});

afterEach(async () => {
  await _resetClientDataDbForTests();
});

// ── listTrashCards ───────────────────────────────────────────────────────────

describe('listTrashCards — grouped restore-unit cards (§3.3)', () => {
  it('folds a persona, its chats, messages and memory into ONE persona card', async () => {
    await seedPersonaCard();

    const cards = await listTrashCards();

    expect(cards.length).toBe(1);
    const card = cards[0];
    if (card === undefined) throw new Error('missing card');
    expect(card.cardKey).toBe('personas:p1');
    expect(card.entityKind).toBe('persona');
    expect(card.title).toBe('Fable');
    // 9 descendants = 2 chats + 6 messages + 1 memory; NO documents key (0).
    expect(card.counts).toEqual({ chats: 2, memories: 1, items: 9 });
    expect('documents' in card.counts).toBe(false);
  });

  it('groups by the parentRef chain (cardKeyOf), not the stored rootGroup hint', async () => {
    // Seed a persona card, then overwrite the rootGroup hint on every row with a
    // deliberately wrong value. Grouping must ignore it and still fold to one card.
    await seedPersonaCard();
    const db = getClientDataDb();
    await db.trash.toCollection().modify((t: TrashRow) => {
      t.rootGroup = 'persona:WRONG';
    });

    const cards = await listTrashCards();

    expect(cards.length).toBe(1);
    expect(cards[0]?.cardKey).toBe('personas:p1');
  });

  it('renders a lone trashed chat (persona still live) as its own chat card', async () => {
    await seedLoneChat();

    const cards = await listTrashCards();

    expect(cards.length).toBe(1);
    const card = cards[0];
    if (card === undefined) throw new Error('missing card');
    expect(card.cardKey).toBe('chats:c9');
    expect(card.entityKind).toBe('chat');
    expect(card.title).toBe('Solo');
    // Only the two messages are descendants; the root chat is not counted.
    expect(card.counts).toEqual({ items: 2 });
    expect('chats' in card.counts).toBe(false);
  });

  it('sorts cards most-recently-deleted first', async () => {
    const db = getClientDataDb();
    await db.trash.bulkPut([
      makeTrashRow(
        'personas',
        'old',
        { id: 'old', name: 'Old' },
        null,
        'persona',
        'persona:old',
        100,
      ),
      makeTrashRow(
        'personas',
        'new',
        { id: 'new', name: 'New' },
        null,
        'persona',
        'persona:new',
        200,
      ),
    ]);

    const cards = await listTrashCards();

    expect(cards.length).toBe(2);
    expect(cards[0]?.cardKey).toBe('personas:new');
    expect(cards[1]?.cardKey).toBe('personas:old');
  });
});
