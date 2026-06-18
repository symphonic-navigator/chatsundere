// SPDX-License-Identifier: AGPL-3.0-only

import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const enqueueSpy = vi.fn();
vi.mock('../../src/knowledge/start-ingestion.js', () => ({
  enqueueDocument: (id: string) => enqueueSpy(id),
}));

import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import {
  importChatsuneLibrary,
  importChatsuneSessions,
  previewChatsuneSessions,
} from '../../src/data/chatsune-import.js';

const SESSIONS = [
  {
    original_id: 's1',
    session_fields: {
      title: 'First',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-02T00:00:00Z',
    },
    messages: [
      { role: 'user' as const, content: 'hi', created_at: '2026-01-01T00:00:00Z' },
      {
        role: 'assistant' as const,
        content: 'hello',
        thinking: 'think',
        created_at: '2026-01-01T00:01:00Z',
      },
      { role: 'tool' as const, content: 'tool-result' },
    ],
  },
  {
    original_id: 's2',
    session_fields: { title: 'Second', deleted_at: '2026-01-03T00:00:00Z' },
    messages: [{ role: 'user' as const, content: 'gone' }],
  },
];

async function seedPersona(): Promise<void> {
  const db = getClientDataDb();
  const settings = await db.settings.get(1);
  await db.personas.add({
    id: 'p1',
    name: 'Fable',
    tagline: '',
    colour: '#fff',
    font: 'serif',
    instructions: '',
    canonicalId: 'c',
    providerId: 'pr',
    modelId: 'm',
    mindspaceId: settings?.defaultMindspaceId ?? null,
    aboutMeOverride: null,
    textureOverride: null,
    temperature: 0.85,
    adultPersona: false,
    chatsundereTonality: true,
    contextWindow: null,
    libraryIds: [],
    askExpertDefault: false,
    mcpOverrides: {},
    roleplay: false,
    narration: 'first',
    greetingEnabled: false,
    greetingInstructions: '',
    voice: null,
    narratorVoice: null,
    createdAt: 1,
    updatedAt: 1,
  });
}

describe('importChatsuneSessions', () => {
  beforeEach(async () => {
    enqueueSpy.mockClear();
    await _resetClientDataDbForTests();
    await openClientDataDb();
    await seedPersona();
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('imports non-deleted sessions, maps Tier A messages, and skips tool messages', async () => {
    const res = await importChatsuneSessions('p1', SESSIONS);
    expect(res).toEqual({ imported: 1, skipped: 0 }); // s2 is deleted → not imported

    const db = getClientDataDb();
    const chats = await db.chats.where('personaId').equals('p1').toArray();
    expect(chats).toHaveLength(1);
    const c0 = chats[0];
    expect(c0).toBeDefined();
    expect(c0?.importedFrom).toBe('s1');
    expect(c0?.title).toBe('First');
    expect(c0?.createdAt).toBe(Date.parse('2026-01-01T00:00:00Z'));

    const chatId = c0?.id ?? '';
    const msgs = await db.messages.where('chatId').equals(chatId).sortBy('createdAt');
    expect(msgs).toHaveLength(2); // tool message skipped
    expect(msgs[0]?.role).toBe('user');
    expect(msgs[1]?.role).toBe('persona');
    expect(msgs[1]?.contentBlocks).toContainEqual({ type: 'reasoning', text: 'think' });
  });

  it('is idempotent: a second import of the same sessions skips them', async () => {
    await importChatsuneSessions('p1', SESSIONS);
    const res = await importChatsuneSessions('p1', SESSIONS);
    expect(res).toEqual({ imported: 0, skipped: 1 });
    const chats = await getClientDataDb().chats.where('personaId').equals('p1').toArray();
    expect(chats).toHaveLength(1);
  });
});

describe('previewChatsuneSessions', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
    await openClientDataDb();
    await seedPersona();
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('returns all sessions as new for a null persona (create mode)', async () => {
    expect(await previewChatsuneSessions(null, SESSIONS)).toEqual({ newCount: 1, skippedCount: 0 });
  });

  it('reports already-imported sessions after one import', async () => {
    await importChatsuneSessions('p1', SESSIONS);
    expect(await previewChatsuneSessions('p1', SESSIONS)).toEqual({ newCount: 0, skippedCount: 1 });
  });
});

describe('importChatsuneLibrary', () => {
  beforeEach(async () => {
    enqueueSpy.mockClear();
    await _resetClientDataDbForTests();
    await openClientDataDb();
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('creates a library and pending documents, enqueueing each for embedding', async () => {
    const libId = await importChatsuneLibrary({
      name: 'Biology',
      description: 'core',
      nsfw: false,
      documents: [
        { title: 'Photosynthesis', content: '# P', triggerPhrases: ['calvin'] },
        { title: 'Empty', content: '   ', triggerPhrases: [] },
      ],
    });
    const db = getClientDataDb();
    const lib = await db.libraries.get(libId);
    expect(lib?.name).toBe('Biology');
    const docs = await db.documents.where('libraryId').equals(libId).toArray();
    expect(docs).toHaveLength(1); // empty-content doc skipped
    expect(docs[0]?.embeddingStatus).toBe('pending');
    expect(docs[0]?.triggerPhrases).toEqual(['calvin']);
    expect(enqueueSpy).toHaveBeenCalledTimes(1);
  });

  it('always creates a new library on re-import (no dedup)', async () => {
    const parsed = { name: 'Dup', description: '', nsfw: false, documents: [] };
    const a = await importChatsuneLibrary(parsed);
    const b = await importChatsuneLibrary(parsed);
    expect(a).not.toBe(b);
    expect(await getClientDataDb().libraries.where('name').equals('Dup').count()).toBe(2);
  });
});
