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
 * Every persisted vector row's sync key (`` `${documentId}#${chunkIndex}` ``,
 * the format pinned by `sync-keys.ts`), for the backfill pump's enumeration
 * (spec §3.6). A `VectorRow`'s primary key IS its sync key, so this is a plain
 * `scan` of the single knowledge collection mapped to row ids. Kept beside
 * `getKnowledgeVectorRow` so the sync side never eagerly loads the embeddings
 * engine — the store is engine-less for scan/upsert/delete.
 */
export async function listKnowledgeVectorSyncKeys(): Promise<string[]> {
  const rows = await getKnowledgeVectorStore().scan({ collection: KNOWLEDGE_COLLECTION });
  return rows.map((row) => row.id);
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

/**
 * Release the module-level vector DB handle and drop the derived singletons
 * (store, engine) without deleting any data. Used by the complete-wipe
 * (`wipeDevice`) so the subsequent `Dexie.delete` of the knowledge-vectors DB
 * sees no open connection and runs to completion rather than tripping the
 * browser's `onblocked` path.
 */
export function closeKnowledgeVectorsDb(): void {
  dbHandle?.close();
  dbHandle = null;
  storeHandle = null;
  enginePromise = null;
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
