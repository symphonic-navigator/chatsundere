import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { resetInterruptedDocuments } from '../../src/knowledge/start-ingestion.js';

beforeEach(async () => {
  await openClientDataDb();
});
afterEach(async () => {
  await _resetClientDataDbForTests({ keepData: false });
});

describe('resetInterruptedDocuments', () => {
  it('resets interrupted "embedding" rows back to "pending"', async () => {
    const db = getClientDataDb();
    await db.documents.bulkAdd([
      mkDoc('a', 'embedding'),
      mkDoc('b', 'ready'),
      mkDoc('c', 'pending'),
    ]);
    const requeued = await resetInterruptedDocuments();
    expect(requeued.sort()).toEqual(['a', 'c']);
    expect((await db.documents.get('a'))?.embeddingStatus).toBe('pending');
    expect((await db.documents.get('b'))?.embeddingStatus).toBe('ready');
  });
});

function mkDoc(id: string, status: 'pending' | 'embedding' | 'ready') {
  return {
    id,
    libraryId: 'l',
    title: 't',
    content: 'c',
    embeddingStatus: status,
    embeddingError: null,
    chunkCount: 0,
    triggerPhrases: [],
    createdAt: 1,
    updatedAt: 1,
  };
}
