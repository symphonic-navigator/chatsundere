// SPDX-License-Identifier: AGPL-3.0-only
import { type Chunk, chunkMarkdown } from '@chatsundere/embeddings';
import type { DocumentRow, EmbeddingStatus } from '../boot/client-data-db.js';

/** Side-effects the queue depends on. Injected so the state machine is testable. */
export interface IngestionDeps {
  getDocument(id: string): Promise<DocumentRow | undefined>;
  setStatus(id: string, status: EmbeddingStatus, error?: string): Promise<void>;
  setReady(id: string, chunkCount: number): Promise<void>;
  embed(texts: string[]): Promise<Float32Array[]>;
  writeChunks(doc: DocumentRow, chunks: Chunk[], vectors: Float32Array[]): Promise<void>;
}

export interface IngestionQueue {
  /** Add a document id to the queue and start draining if idle. */
  enqueue(id: string): void;
  /** Process exactly one document to completion (used in tests + the drain loop). */
  process(id: string): Promise<void>;
  /** Resolves when the queue has drained. */
  idle(): Promise<void>;
}

export function createIngestionQueue(deps: IngestionDeps): IngestionQueue {
  const queue: string[] = [];
  const seen = new Set<string>();
  let draining: Promise<void> | null = null;

  async function process(id: string): Promise<void> {
    const doc = await deps.getDocument(id);
    if (!doc) return; // already deleted
    await deps.setStatus(id, 'embedding');
    try {
      const chunks = chunkMarkdown(doc.content);
      if (chunks.length === 0) {
        if (await deps.getDocument(id)) await deps.setReady(id, 0);
        return;
      }
      const vectors = await deps.embed(chunks.map((c) => c.text));
      const still = await deps.getDocument(id);
      if (!still) return; // deleted mid-flight → discard
      await deps.writeChunks(still, chunks, vectors);
      await deps.setReady(id, chunks.length);
    } catch (err) {
      if (await deps.getDocument(id)) {
        await deps.setStatus(id, 'failed', err instanceof Error ? err.message : String(err));
      }
    }
  }

  async function drain(): Promise<void> {
    while (queue.length > 0) {
      const id = queue.shift();
      if (id === undefined) break;
      seen.delete(id);
      await process(id);
    }
    draining = null;
  }

  return {
    enqueue(id) {
      if (seen.has(id)) return;
      seen.add(id);
      queue.push(id);
      if (!draining) draining = drain();
    },
    process,
    idle() {
      return draining ?? Promise.resolve();
    },
  };
}
