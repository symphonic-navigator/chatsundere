// SPDX-License-Identifier: AGPL-3.0-only

import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  type MindspaceRow,
  type SettingsRow,
  _resetClientDataDbForTests,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';

beforeEach(async () => {
  await _resetClientDataDbForTests();
});

describe('chatsundere_client_data Dexie schema', () => {
  it('opens cleanly on a fresh origin', async () => {
    const db = await openClientDataDb();
    expect(db.verno).toBe(1);
  });

  it('seeds three built-in mindspaces on first open', async () => {
    const db = await openClientDataDb();
    const all = await db.mindspaces.toArray();
    const names = all.map((m) => m.displayName).sort();
    expect(names).toEqual(['Aurum', 'Azuro', 'Verdan']);
    expect(all.every((m: MindspaceRow) => m.builtIn === true)).toBe(true);
  });

  it('seeds the settings singleton with Aurum as default mindspace', async () => {
    const db = await openClientDataDb();
    const settings = await db.settings.get(1);
    expect(settings).toBeDefined();
    expect(settings?.id).toBe(1);
    const aurum = await db.mindspaces.where('displayName').equals('Aurum').first();
    expect(aurum).toBeDefined();
    expect(settings?.defaultMindspaceId).toBe(aurum?.id);
    expect(settings?.globalUnlockerPrompt).toBe('');
    expect(settings?.globalAboutMe).toBe('');
    expect(settings?.corsProxy).toBeNull();
  });

  it('is idempotent on re-open — does not double-seed', async () => {
    await openClientDataDb();
    await _resetClientDataDbForTests({ keepData: true });
    const db2 = await openClientDataDb();
    const all = await db2.mindspaces.toArray();
    expect(all.length).toBe(3);
    const settingsRows = await db2.settings.toArray();
    expect(settingsRows.length).toBe(1);
  });

  it('has the declared compound indices', async () => {
    const db = await openClientDataDb();
    const schema = db.tables.find((t) => t.name === 'messages');
    expect(schema).toBeDefined();
    expect(schema?.schema.indexes.some((i) => i.name === '[chatId+createdAt]')).toBe(true);
    const chatSchema = db.tables.find((t) => t.name === 'chats');
    expect(chatSchema?.schema.indexes.some((i) => i.name === '[personaId+lastMessageAt]')).toBe(
      true,
    );
  });
});
