// SPDX-License-Identifier: AGPL-3.0-only

import 'fake-indexeddb/auto';
import Dexie from 'dexie';
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
    expect(db.verno).toBe(27);
  });

  it('v15 backfills libraryIds to [] on personas and chats', async () => {
    const db = await openClientDataDb();
    const persona = await db.personas.toArray();
    const chats = await db.chats.toArray();
    for (const p of persona) expect(Array.isArray(p.libraryIds)).toBe(true);
    for (const c of chats) expect(Array.isArray(c.libraryIds)).toBe(true);
    expect(db.verno).toBe(27);
  });

  it('v16 seeds expertModel null on fresh settings', async () => {
    const db = await openClientDataDb();
    const settings = await db.settings.get(1);
    expect(settings?.expertModel).toBeNull();
  });

  it('seeds seven built-in mindspaces on first open', async () => {
    const db = await openClientDataDb();
    const all = await db.mindspaces.toArray();
    const names = all.map((m) => m.displayName).sort();
    expect(names).toEqual([
      'Aurum',
      'Azuro',
      'Crimson',
      'Indigaut',
      'Rosari',
      'Verdan',
      'Violetta',
    ]);
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
    expect(settings?.globalInstructions).toBe('');
    expect(settings?.globalAboutMe).toBe('');
    expect(settings?.corsProxy).toBeNull();
  });

  it('is idempotent on re-open — does not double-seed', async () => {
    await openClientDataDb();
    await _resetClientDataDbForTests({ keepData: true });
    const db2 = await openClientDataDb();
    const all = await db2.mindspaces.toArray();
    expect(all.length).toBe(7);
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

describe('client-data DB — v2 migration', () => {
  it('seeds seven built-in mindspaces on a fresh database', async () => {
    await _resetClientDataDbForTests();
    const db = await openClientDataDb();
    const mindspaces = await db.mindspaces.toArray();
    const names = mindspaces.map((m) => m.displayName).sort();
    expect(names).toEqual([
      'Aurum',
      'Azuro',
      'Crimson',
      'Indigaut',
      'Rosari',
      'Verdan',
      'Violetta',
    ]);
  });

  it('uses finalised accent hex for Verdan (#6aa97a) and Azuro (#4a7eb3)', async () => {
    await _resetClientDataDbForTests();
    const db = await openClientDataDb();
    const verdan = await db.mindspaces.where('displayName').equals('Verdan').first();
    const azuro = await db.mindspaces.where('displayName').equals('Azuro').first();
    expect(verdan?.palette.accent).toBe('#6aa97a');
    expect(azuro?.palette.accent).toBe('#4a7eb3');
  });

  it('backfills persona fields and missing mindspaces when upgrading from v1', async () => {
    // Simulate v1: open as v1 only, seed, close, then re-open at v2.
    await _resetClientDataDbForTests();
    const v1 = new Dexie('chatsundere_client_data');
    v1.version(1).stores({
      settings: 'id',
      providers: 'id, templateId, enabled',
      mindspaces: 'id, builtIn, displayName',
      personas: 'id, providerId',
      chats: 'id, personaId, lastMessageAt, [personaId+lastMessageAt]',
      messages: 'id, chatId, [chatId+createdAt]',
      pills: 'id, messageId',
    });
    await v1.open();
    // Plant a v1-shape settings row and a v1-shape persona row.
    const now = Date.now();
    await v1.table('settings').add({
      id: 1,
      globalUnlockerPrompt: 'unlock',
      globalAboutMe: 'about',
      defaultMindspaceId: 'aurum-id',
      animationsEnabled: true,
      corsProxy: null,
      createdAt: now,
      updatedAt: now,
    });
    await v1.table('personas').add({
      id: 'p1',
      name: 'Test',
      colour: '#c9a84c',
      font: 'serif',
      instructions: 'be helpful',
      providerId: 'np',
      modelId: 'm1',
      mindspaceId: null,
      aboutMeOverride: null,
      createdAt: now,
      updatedAt: now,
    });
    v1.close();

    // Now open via the v2 entrypoint and verify backfills.
    await _resetClientDataDbForTests({ keepData: true });
    const db = await openClientDataDb();
    const persona = await db.personas.get('p1');
    expect(persona?.tagline).toBe('');
    expect(persona?.temperature).toBeCloseTo(0.85);
    expect(persona?.adultPersona).toBe(false);
    const mindspaces = await db.mindspaces.toArray();
    expect(mindspaces.length).toBeGreaterThanOrEqual(7);
  });
});
