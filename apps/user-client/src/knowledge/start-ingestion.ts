// SPDX-License-Identifier: AGPL-3.0-only
import type { Chunk } from '@chatsundere/embeddings';
import { type DocumentRow, type EmbeddingStatus, getClientDataDb } from '../boot/client-data-db.js';
import {
  KNOWLEDGE_COLLECTION,
  getEmbeddingEngine,
  getKnowledgeVectorStore,
} from '../boot/knowledge-vectors-db.js';
import { type IngestionQueue, createIngestionQueue } from './ingestion-queue.js';

let queue: IngestionQueue | null = null;

function realQueue(): IngestionQueue {
  if (queue) return queue;
  const db = getClientDataDb();
  const store = getKnowledgeVectorStore();
  queue = createIngestionQueue({
    getDocument: (id) => db.documents.get(id),
    setStatus: async (id, status: EmbeddingStatus, error?: string) => {
      // Surface embedding failures to the console — the badge only shows "Failed"
      // and the error otherwise lives silently in the DB row (a blind spot during
      // the first device test). The detail page also shows it as a badge tooltip.
      if (status === 'failed') console.error(`[knowledge] embedding failed for ${id}: ${error}`);
      await db.documents.update(id, {
        embeddingStatus: status,
        embeddingError: error ?? null,
        updatedAt: Date.now(),
      });
    },
    setReady: async (id, chunkCount) => {
      await db.documents.update(id, {
        embeddingStatus: 'ready',
        embeddingError: null,
        chunkCount,
        updatedAt: Date.now(),
      });
    },
    embed: async (texts) => {
      const engine = await getEmbeddingEngine();
      return engine.embed(texts, { kind: 'document' });
    },
    writeChunks: async (doc: DocumentRow, chunks: Chunk[], vectors: Float32Array[]) => {
      await store.deleteWhere({
        collection: KNOWLEDGE_COLLECTION,
        filter: { tags: { documentId: doc.id } },
      });
      const now = Date.now();
      await store.upsert(
        chunks.map((c, i) => ({
          id: `${doc.id}#${c.chunkIndex}`,
          collection: KNOWLEDGE_COLLECTION,
          // biome-ignore lint/style/noNonNullAssertion: vectors and chunks are 1:1 by construction
          vector: vectors[i]!,
          tags: { libraryId: doc.libraryId, documentId: doc.id },
          numeric: { chunkIndex: c.chunkIndex },
          metadata: { text: c.text, headingPath: c.headingPath },
          updatedAt: now,
        })),
      );
    },
  });
  return queue;
}

/** Enqueue a document for embedding. Safe to call before the app has started. */
export function enqueueDocument(id: string): void {
  realQueue().enqueue(id);
}

/**
 * Reset any document left mid-embed (process interrupted by reload/crash) back
 * to `pending`. Returns the ids of all documents now needing embedding
 * (interrupted + already-pending).
 */
export async function resetInterruptedDocuments(): Promise<string[]> {
  const db = getClientDataDb();
  const interrupted = await db.documents.where('embeddingStatus').equals('embedding').toArray();
  for (const doc of interrupted) {
    await db.documents.update(doc.id, { embeddingStatus: 'pending', updatedAt: Date.now() });
  }
  const pending = await db.documents.where('embeddingStatus').equals('pending').toArray();
  return pending.map((d) => d.id);
}

/** Boot entry point: reset interrupted documents and enqueue all pending ones. */
export async function startKnowledgeIngestion(): Promise<void> {
  const ids = await resetInterruptedDocuments();
  for (const id of ids) enqueueDocument(id);
}

/** Test-only: drop the singleton queue. */
export function _resetIngestionQueueForTests(): void {
  queue = null;
}
