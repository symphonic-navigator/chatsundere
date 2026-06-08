import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type ChatRow,
  type PersonaRow,
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import {
  KNOWLEDGE_COLLECTION,
  _resetKnowledgeVectorsForTests,
  getKnowledgeVectorStore,
} from '../../src/boot/knowledge-vectors-db.js';
import { createLibrary, deleteLibraryCascade, listLibraries } from '../../src/data/knowledge.js';

function makePersona(overrides: Partial<PersonaRow> = {}): PersonaRow {
  return {
    id: 'p',
    name: 'P',
    tagline: '',
    colour: '#000000',
    font: 'sans',
    instructions: '',
    canonicalId: null,
    providerId: '',
    modelId: '',
    mindspaceId: null,
    aboutMeOverride: null,
    textureOverride: null,
    temperature: 0.7,
    adultPersona: false,
    chatsundereTonality: false,
    contextWindow: null,
    libraryIds: [],
    askExpertDefault: false,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function makeChat(overrides: Partial<ChatRow> = {}): ChatRow {
  return {
    id: 'c',
    personaId: 'p',
    title: null,
    resolvedMindspaceId: '',
    createdAt: 1,
    lastMessageAt: 1,
    bookmarkedMessageCount: 0,
    draftInput: '',
    libraryIds: [],
    ...overrides,
  };
}

beforeEach(async () => {
  await openClientDataDb();
});
afterEach(async () => {
  await _resetClientDataDbForTests({ keepData: false });
  await _resetKnowledgeVectorsForTests();
});

describe('library data layer', () => {
  it('creates and lists libraries oldest-first', async () => {
    await createLibrary({ name: 'B', description: '', nsfw: false });
    await createLibrary({ name: 'A', description: 'desc', nsfw: true });
    const libs = await listLibraries();
    expect(libs.map((l) => l.name)).toEqual(['B', 'A']);
  });

  it('deleteLibraryCascade removes its documents and their vectors', async () => {
    const lib = await createLibrary({ name: 'L', description: '', nsfw: false });
    const db = getClientDataDb();
    await db.documents.add({
      id: 'd1',
      libraryId: lib.id,
      title: 't',
      content: 'c',
      embeddingStatus: 'ready',
      embeddingError: null,
      chunkCount: 1,
      triggerPhrases: [],
      createdAt: 1,
      updatedAt: 1,
    });
    await getKnowledgeVectorStore().upsert([
      {
        id: 'd1#0',
        collection: KNOWLEDGE_COLLECTION,
        vector: new Float32Array(768).fill(0.1),
        tags: { libraryId: lib.id, documentId: 'd1' },
        numeric: { chunkIndex: 0 },
        updatedAt: 1,
      },
    ]);

    await deleteLibraryCascade(lib.id);

    expect(await db.libraries.get(lib.id)).toBeUndefined();
    expect(await db.documents.where('libraryId').equals(lib.id).count()).toBe(0);
    expect(await getKnowledgeVectorStore().scan({ collection: KNOWLEDGE_COLLECTION })).toHaveLength(
      0,
    );
  });

  it('deleteLibraryCascade prunes the id from personas and chats', async () => {
    const db = getClientDataDb();
    const lib = await createLibrary({ name: 'L', description: '', nsfw: false });
    const other = await createLibrary({ name: 'Other', description: '', nsfw: false });
    await db.personas.add(makePersona({ id: 'p1', libraryIds: [lib.id, other.id] }));
    await db.chats.add(makeChat({ id: 'c1', personaId: 'p1', libraryIds: [lib.id] }));

    await deleteLibraryCascade(lib.id);

    expect((await db.personas.get('p1'))?.libraryIds).toEqual([other.id]);
    expect((await db.chats.get('c1'))?.libraryIds).toEqual([]);
  });
});
