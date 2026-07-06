import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';

beforeEach(async () => {
  await openClientDataDb();
});
afterEach(async () => {
  await _resetClientDataDbForTests({ keepData: false });
});

describe('knowledge schema (v14)', () => {
  it('opens at version 17', () => {
    expect(getClientDataDb().verno).toBe(35);
  });

  it('round-trips a library and a document', async () => {
    const db = getClientDataDb();
    await db.libraries.add({
      id: 'lib1',
      name: 'Lore',
      description: '',
      nsfw: false,
      createdAt: 1,
      updatedAt: 1,
    });
    await db.documents.add({
      id: 'doc1',
      libraryId: 'lib1',
      title: 'Intro',
      content: 'Hello',
      embeddingStatus: 'pending',
      embeddingError: null,
      chunkCount: 0,
      triggerPhrases: [],
      createdAt: 1,
      updatedAt: 1,
    });
    const docs = await db.documents.where('libraryId').equals('lib1').toArray();
    expect(docs).toHaveLength(1);
    expect(docs[0]?.title).toBe('Intro');
  });
});
