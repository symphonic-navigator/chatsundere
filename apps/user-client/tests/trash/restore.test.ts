// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import type { SyncCollection } from '@chatsundere/shared-types';
import { useAccountLinkStore, useConnectivityStore, useSessionStore } from '@chatsundere/ui-shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TrashRow } from '../../src/boot/client-data-db.js';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { setImmediateDrain } from '../../src/sync/enqueue.js';
import { _resetTriggersForTests, _setTriggerCycle } from '../../src/sync/triggers.js';
import { cardKeyOf, restoreCard, rowsOfCard } from '../../src/trash/trash-repo.js';

// ── Store helpers ────────────────────────────────────────────────────────────

/** Linked + reachable + unlocked → Class-2 writes are allowed. */
function setOnline(): void {
  useAccountLinkStore.setState({ linkStatus: 'linked', baseUrl: 'https://server.example' });
  useConnectivityStore.setState({ state: { kind: 'linked_online' } });
  useSessionStore.setState({ mk: { key: 'fake-mk' } as never });
}

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
      {
        id: 'm1',
        chatId: 'c1',
        contentBlocks: [
          { type: 'text', text: 'hi' },
          { type: 'pill', pillId: 'pl-live' },
        ],
      },
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

// ── cardKeyOf / rowsOfCard unit tests ────────────────────────────────────────

describe('cardKeyOf / rowsOfCard — card = highest TRASHED ancestor', () => {
  it('groups a message under the persona when both chat and persona are trashed', () => {
    const rows: TrashRow[] = [
      makeTrashRow('personas', 'p1', { id: 'p1' }, null, 'persona', 'persona:p1'),
      makeTrashRow(
        'chats',
        'c1',
        { id: 'c1', personaId: 'p1' },
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
    ];
    const byId = new Map(rows.map((r) => [r.id, r] as const));
    const msg = rows[2];
    if (msg === undefined) throw new Error('seed error');
    expect(cardKeyOf(msg, byId)).toBe('personas:p1');
    expect(new Set(rowsOfCard('personas:p1', rows).map((r) => r.id))).toEqual(
      new Set(['personas:p1', 'chats:c1', 'messages:m1']),
    );
  });

  it('groups a message under the chat when the chat is trashed but the persona is live', () => {
    const rows: TrashRow[] = [
      makeTrashRow(
        'chats',
        'c1',
        { id: 'c1', personaId: 'p-live' },
        { field: 'personaId', id: 'p-live' },
        'chat',
        'persona:p-live',
      ),
      makeTrashRow(
        'messages',
        'm1',
        { id: 'm1', chatId: 'c1' },
        { field: 'chatId', id: 'c1' },
        'chatChild',
        'persona:p-live',
      ),
    ];
    const byId = new Map(rows.map((r) => [r.id, r] as const));
    const msg = rows[1];
    if (msg === undefined) throw new Error('seed error');
    expect(cardKeyOf(msg, byId)).toBe('chats:c1');
  });
});

// ── restoreCard integration ──────────────────────────────────────────────────

describe('restoreCard — new-identity cascade with remap + restoredFrom', () => {
  it('re-materialises the card under fresh ids, remaps refs, enqueues upserts, keeps dead-keys', async () => {
    setOnline();
    await seedPersonaCard();
    const db = getClientDataDb();

    await restoreCard('personas:p1');

    // Four fresh rows in the live tables.
    const personas = await db.personas.toArray();
    const chats = await db.chats.toArray();
    const messages = await db.messages.toArray();
    const memories = await db.memoryJournal.toArray();
    expect(personas.length).toBe(1);
    expect(chats.length).toBe(1);
    expect(messages.length).toBe(1);
    expect(memories.length).toBe(1);

    const persona = personas[0];
    const chat = chats[0];
    const message = messages[0];
    const memory = memories[0];
    if (!persona || !chat || !message || !memory) throw new Error('missing restored row');

    // Fresh identities (≠ originals).
    expect(persona.id).not.toBe('p1');
    expect(chat.id).not.toBe('c1');
    expect(message.id).not.toBe('m1');
    expect(memory.id).not.toBe('mem1');

    // Parent refs remapped to the NEW parent ids.
    expect(chat.personaId).toBe(persona.id);
    expect(message.chatId).toBe(chat.id);
    expect(memory.personaId).toBe(persona.id);

    // restoredFrom carries each entity's ORIGINAL key.
    expect((persona as unknown as { restoredFrom?: string }).restoredFrom).toBe('p1');
    expect((chat as unknown as { restoredFrom?: string }).restoredFrom).toBe('c1');
    expect((message as unknown as { restoredFrom?: string }).restoredFrom).toBe('m1');
    expect((memory as unknown as { restoredFrom?: string }).restoredFrom).toBe('mem1');

    // A fresh upsert for each of the four new ids.
    const upserts = (await db.syncOutbox.toArray()).filter((r) => r.op === 'upsert');
    expect(new Set(upserts.map((r) => `${r.collection}:${r.key}`))).toEqual(
      new Set([
        `personas:${persona.id}`,
        `chats:${chat.id}`,
        `messages:${message.id}`,
        `memoryJournal:${memory.id}`,
      ]),
    );

    // Trash snapshots cleared.
    expect(await db.trash.count()).toBe(0);

    // Dead-keys retained for the OLD identities; the NEW ids are NOT dead.
    expect(await db.deadKeys.get('personas:p1')).toBeDefined();
    expect(await db.deadKeys.get('chats:c1')).toBeDefined();
    expect(await db.deadKeys.get('messages:m1')).toBeDefined();
    expect(await db.deadKeys.get('memoryJournal:mem1')).toBeDefined();
    expect(await db.deadKeys.get(`personas:${persona.id}`)).toBeUndefined();
    expect(await db.deadKeys.get(`chats:${chat.id}`)).toBeUndefined();
  });
});
