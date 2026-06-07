import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  KNOWLEDGE_COLLECTION,
  _resetKnowledgeVectorsForTests,
  getKnowledgeVectorStore,
} from '../../src/boot/knowledge-vectors-db.js';

afterEach(async () => {
  await _resetKnowledgeVectorsForTests();
});

describe('knowledge vector store', () => {
  it('upserts and scans chunk vectors by document tag', async () => {
    const store = getKnowledgeVectorStore();
    await store.upsert([
      {
        id: 'doc1#0',
        collection: KNOWLEDGE_COLLECTION,
        vector: new Float32Array(768).fill(0.1),
        tags: { libraryId: 'lib1', documentId: 'doc1' },
        numeric: { chunkIndex: 0 },
        metadata: { text: 'hello', headingPath: [] },
        updatedAt: 1,
      },
    ]);
    const rows = await store.scan({
      collection: KNOWLEDGE_COLLECTION,
      filter: { tags: { documentId: 'doc1' } },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.metadata).toEqual({ text: 'hello', headingPath: [] });
  });

  it("deleteWhere removes a document's vectors", async () => {
    const store = getKnowledgeVectorStore();
    await store.upsert([
      {
        id: 'doc2#0',
        collection: KNOWLEDGE_COLLECTION,
        vector: new Float32Array(768).fill(0.2),
        tags: { libraryId: 'lib1', documentId: 'doc2' },
        numeric: { chunkIndex: 0 },
        updatedAt: 1,
      },
    ]);
    const removed = await store.deleteWhere({
      collection: KNOWLEDGE_COLLECTION,
      filter: { tags: { documentId: 'doc2' } },
    });
    expect(removed).toBe(1);
    const rows = await store.scan({ collection: KNOWLEDGE_COLLECTION });
    expect(rows).toHaveLength(0);
  });
});
