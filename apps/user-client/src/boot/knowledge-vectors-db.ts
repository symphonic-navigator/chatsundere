// SPDX-License-Identifier: AGPL-3.0-only
import {
  type EmbeddingEngine,
  VECTORS_STORE_SCHEMA,
  type VectorRow,
  type VectorStore,
  createEmbeddingEngine,
  createVectorStore,
} from '@chatsundere/embeddings';
import Dexie, { type Table } from 'dexie';
import { useModelProgressStore } from '../state/model-progress.store.js';

/** The single vector-store collection for all knowledgebase chunks. */
export const KNOWLEDGE_COLLECTION = 'knowledge';

/** The subset of VectorStore the knowledge data layer + queue depend on. */
export type VectorStoreLike = Pick<VectorStore, 'upsert' | 'deleteWhere' | 'scan'>;

const VECTORS_DB_NAME = 'chatsundere-knowledge-vectors';

class KnowledgeVectorsDb extends Dexie {
  vectors!: Table<VectorRow, string>;
  constructor() {
    super(VECTORS_DB_NAME);
    this.version(1).stores({ vectors: VECTORS_STORE_SCHEMA });
  }
}

let dbHandle: KnowledgeVectorsDb | null = null;
let storeHandle: VectorStore | null = null;
let enginePromise: Promise<EmbeddingEngine> | null = null;

function db(): KnowledgeVectorsDb {
  if (!dbHandle) dbHandle = new KnowledgeVectorsDb();
  return dbHandle;
}

/**
 * The shared knowledge vector store. Engine-less: Chunk A only upserts/deletes/
 * scans (we embed manually during ingestion); text queries (Chunk B) pass a
 * pre-embedded vector, so the store never needs the engine itself.
 */
export function getKnowledgeVectorStore(): VectorStore {
  if (!storeHandle) storeHandle = createVectorStore({ db: db(), table: db().vectors });
  return storeHandle;
}

/**
 * Read one persisted vector row by its primary key (the sync key
 * `` `${documentId}#${chunkIndex}` `` for a knowledge chunk). Used by the sync
 * drain to seal a `vectors` outbox entry, since the `VectorStore` façade only
 * exposes bulk scan/upsert/delete. Returns undefined when the chunk is gone.
 */
export function getKnowledgeVectorRow(key: string): Promise<VectorRow | undefined> {
  return db().vectors.get(key);
}

/**
 * The shared on-device embedding engine, created once. Surfaces load progress
 * to the model-progress store so the UI can show a one-time download banner.
 */
export function getEmbeddingEngine(): Promise<EmbeddingEngine> {
  if (!enginePromise) {
    const progress = useModelProgressStore.getState();
    progress.setLoading(true);
    const t0 = performance.now();
    enginePromise = createEmbeddingEngine({
      onProgress: (data: unknown) => {
        const d = data as { progress?: number };
        if (typeof d.progress === 'number') progress.setProgress(d.progress / 100);
      },
    }).then((engine) => {
      useModelProgressStore.getState().setReady();
      // One-time diagnostic: which backend actually resolved, and how long the
      // model took to load. The slowness lever is almost always device=wasm with
      // wasmThreads=1 (no WebGPU + not crossOriginIsolated).
      const b = engine.backend;
      console.info(
        `[embedding-backend] device=${b.device} mode=${b.executionMode} dtype=${b.dtype} ` +
          `wasmThreads=${b.wasmThreadsConfigured} crossOriginIsolated=${b.crossOriginIsolated} ` +
          `webgpuAvailable=${b.webgpuAvailable} — model ready in ${Math.round(performance.now() - t0)} ms`,
      );
      if (b.fallbackTrail.length > 0) {
        console.info(`[embedding-backend] fallback trail:\n${b.fallbackTrail.join('\n')}`);
      }
      return engine;
    });
  }
  return enginePromise;
}

/** Test-only: drop the in-memory singletons and delete the IndexedDB database. */
export async function _resetKnowledgeVectorsForTests(): Promise<void> {
  if (dbHandle) {
    dbHandle.close();
    await dbHandle.delete();
  }
  dbHandle = null;
  storeHandle = null;
  enginePromise = null;
}
