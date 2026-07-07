// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type MindspaceRow,
  _resetClientDataDbForTests,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';

/** Minimal v35 store set — Dexie creates the rest at head-open. */
const V35_MIN_STORES = {
  settings: 'id',
  mindspaces: 'id, builtIn, displayName',
  personas: 'id, providerId',
  chats: 'id, personaId, lastMessageAt, [personaId+lastMessageAt]',
  trash: 'id, purgeAt, rootGroup',
} as const;

/** The seven built-ins as a pre-v36 device seeded them: per-device uuids. */
const LEGACY_BUILTINS: ReadonlyArray<{ oldId: string; displayName: string }> = [
  { oldId: 'uuid-crimson', displayName: 'Crimson' },
  { oldId: 'uuid-aurum', displayName: 'Aurum' },
  { oldId: 'uuid-verdan', displayName: 'Verdan' },
  { oldId: 'uuid-azuro', displayName: 'Azuro' },
  { oldId: 'uuid-indigaut', displayName: 'Indigaut' },
  { oldId: 'uuid-violetta', displayName: 'Violetta' },
  { oldId: 'uuid-rosari', displayName: 'Rosari' },
];

const SLUGS = [
  'mindspace-builtin-aurum',
  'mindspace-builtin-azuro',
  'mindspace-builtin-crimson',
  'mindspace-builtin-indigaut',
  'mindspace-builtin-rosari',
  'mindspace-builtin-verdan',
  'mindspace-builtin-violetta',
];

function legacyMindspace(oldId: string, displayName: string): Record<string, unknown> {
  return {
    id: oldId,
    displayName,
    palette: { accent: '#c9a84c' },
    texture: 'cloudy',
    builtIn: true,
    createdAt: 111,
    updatedAt: 111,
  };
}

async function plantV35(rows: {
  settings?: Record<string, unknown>;
  personas?: Record<string, unknown>[];
  chats?: Record<string, unknown>[];
  trash?: Record<string, unknown>[];
}): Promise<void> {
  const db = new Dexie('chatsundere_client_data');
  db.version(35).stores(V35_MIN_STORES);
  await db.open();
  await db
    .table('mindspaces')
    .bulkAdd(LEGACY_BUILTINS.map((b) => legacyMindspace(b.oldId, b.displayName)));
  if (rows.settings) await db.table('settings').add(rows.settings);
  if (rows.personas) await db.table('personas').bulkAdd(rows.personas);
  if (rows.chats) await db.table('chats').bulkAdd(rows.chats);
  if (rows.trash) await db.table('trash').bulkAdd(rows.trash);
  db.close();
}

describe('client-data-db v36 (built-in mindspace ids → deterministic slugs)', () => {
  beforeEach(async () => await _resetClientDataDbForTests());
  afterEach(async () => await _resetClientDataDbForTests());

  it('opens at verno 36 on a fresh install and seeds slug ids', async () => {
    const db = await openClientDataDb();
    expect(db.verno).toBe(36);
    const ids = (await db.mindspaces.toArray()).map((m) => m.id).sort();
    expect(ids).toEqual(SLUGS);
  });

  it('rekeys legacy uuid built-ins to slugs, preserving texture and createdAt', async () => {
    await plantV35({});
    // Give one row a non-default texture to prove preservation.
    const raw = new Dexie('chatsundere_client_data');
    raw.version(35).stores(V35_MIN_STORES);
    await raw.open();
    await raw.table('mindspaces').update('uuid-aurum', { texture: 'aurora' });
    raw.close();

    await _resetClientDataDbForTests({ keepData: true });
    const db = await openClientDataDb();
    expect(db.verno).toBe(36);

    const all = (await db.mindspaces.toArray()) as MindspaceRow[];
    expect(all.map((m) => m.id).sort()).toEqual(SLUGS);
    const aurum = await db.mindspaces.get('mindspace-builtin-aurum');
    expect(aurum?.texture).toBe('aurora');
    expect(aurum?.createdAt).toBe(111);
    expect(await db.mindspaces.get('uuid-aurum')).toBeUndefined();
  });

  it('remaps settings.defaultMindspaceId, personas.mindspaceId and chats.resolvedMindspaceId', async () => {
    await plantV35({
      settings: { id: 1, defaultMindspaceId: 'uuid-aurum', createdAt: 1, updatedAt: 1 },
      personas: [
        { id: 'p-mapped', providerId: 'prov', mindspaceId: 'uuid-verdan', updatedAt: 5 },
        { id: 'p-null', providerId: 'prov', mindspaceId: null },
        { id: 'p-ghost', providerId: 'prov', mindspaceId: 'ghost-id' },
      ],
      chats: [
        {
          id: 'c-mapped',
          personaId: 'p-mapped',
          resolvedMindspaceId: 'uuid-crimson',
          updatedAt: 6,
        },
        { id: 'c-ghost', personaId: 'p-mapped', resolvedMindspaceId: 'ghost-id' },
      ],
    });
    await _resetClientDataDbForTests({ keepData: true });
    const db = await openClientDataDb();

    expect((await db.settings.get(1))?.defaultMindspaceId).toBe('mindspace-builtin-aurum');
    expect((await db.personas.get('p-mapped'))?.mindspaceId).toBe('mindspace-builtin-verdan');
    expect((await db.personas.get('p-null'))?.mindspaceId).toBeNull();
    // Unknown references (historic imports) pass through untouched.
    expect((await db.personas.get('p-ghost'))?.mindspaceId).toBe('ghost-id');
    expect((await db.chats.get('c-mapped'))?.resolvedMindspaceId).toBe('mindspace-builtin-crimson');
    expect((await db.chats.get('c-ghost'))?.resolvedMindspaceId).toBe('ghost-id');
    // updatedAt must NOT be bumped by the remap — a bump would let the row
    // clobber genuinely newer remote edits of other fields under LWW.
    expect((await db.settings.get(1))?.updatedAt).toBe(1);
    expect((await db.personas.get('p-mapped'))?.updatedAt).toBe(5);
    expect((await db.chats.get('c-mapped'))?.updatedAt).toBe(6);
  });

  it('leaves non-built-in rows and unknown built-in names untouched', async () => {
    await plantV35({});
    const raw = new Dexie('chatsundere_client_data');
    raw.version(35).stores(V35_MIN_STORES);
    await raw.open();
    await raw.table('mindspaces').bulkAdd([
      // A user-style row sharing a built-in's displayName: rekey is builtIn-gated.
      { ...legacyMindspace('user-crimson', 'Crimson'), builtIn: false },
      // A builtIn-flagged row whose name is outside the canonical seven.
      legacyMindspace('uuid-custom', 'Custom'),
    ]);
    raw.close();

    await _resetClientDataDbForTests({ keepData: true });
    const db = await openClientDataDb();

    expect((await db.mindspaces.get('user-crimson'))?.displayName).toBe('Crimson');
    expect((await db.mindspaces.get('uuid-custom'))?.displayName).toBe('Custom');
    const slugRows = (await db.mindspaces.toArray()).filter((m) =>
      m.id.startsWith('mindspace-builtin-'),
    );
    expect(slugRows.map((m) => m.id).sort()).toEqual(SLUGS);
  });

  it('remaps mindspace references inside trash row snapshots', async () => {
    await plantV35({
      trash: [
        {
          id: 'trash-persona',
          collection: 'personas',
          key: 'p-dead',
          row: { id: 'p-dead', mindspaceId: 'uuid-rosari' },
          deletedAt: 1,
          purgeAt: 2,
          entityKind: 'persona',
          rootGroup: 'persona:p-dead',
          parentRef: null,
        },
        {
          id: 'trash-chat',
          collection: 'chats',
          key: 'c-dead',
          row: { id: 'c-dead', personaId: 'p-dead', resolvedMindspaceId: 'uuid-azuro' },
          deletedAt: 1,
          purgeAt: 2,
          entityKind: 'chat',
          rootGroup: 'persona:p-dead',
          parentRef: { field: 'personaId', id: 'p-dead' },
        },
        {
          id: 'trash-other',
          collection: 'messages',
          key: 'm-dead',
          row: { id: 'm-dead', chatId: 'c-dead' },
          deletedAt: 1,
          purgeAt: 2,
          entityKind: 'chatChild',
          rootGroup: 'persona:p-dead',
          parentRef: { field: 'chatId', id: 'c-dead' },
        },
      ],
    });
    await _resetClientDataDbForTests({ keepData: true });
    const db = await openClientDataDb();

    const personaSnap = (await db.trash.get('trash-persona'))?.row as Record<string, unknown>;
    expect(personaSnap.mindspaceId).toBe('mindspace-builtin-rosari');
    const chatSnap = (await db.trash.get('trash-chat'))?.row as Record<string, unknown>;
    expect(chatSnap.resolvedMindspaceId).toBe('mindspace-builtin-azuro');
    const otherSnap = (await db.trash.get('trash-other'))?.row as Record<string, unknown>;
    expect(otherSnap).toEqual({ id: 'm-dead', chatId: 'c-dead' });
  });

  it('is idempotent — re-opening a migrated DB changes nothing', async () => {
    await plantV35({
      settings: { id: 1, defaultMindspaceId: 'uuid-aurum', createdAt: 1, updatedAt: 1 },
    });
    await _resetClientDataDbForTests({ keepData: true });
    await openClientDataDb();

    await _resetClientDataDbForTests({ keepData: true });
    const db = await openClientDataDb();
    const all = await db.mindspaces.toArray();
    expect(all).toHaveLength(7);
    expect(all.map((m) => m.id).sort()).toEqual(SLUGS);
    expect((await db.settings.get(1))?.defaultMindspaceId).toBe('mindspace-builtin-aurum');
  });
});
