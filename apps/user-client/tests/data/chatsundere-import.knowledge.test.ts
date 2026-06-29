// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only

// Mock getEmbeddingEngine to throw — the adopt path must NEVER call the engine.
// The mock is hoisted by Vitest before any import, so all modules that import
// from knowledge-vectors-db.js will receive the mock implementation.
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../src/boot/knowledge-vectors-db.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/boot/knowledge-vectors-db.js')>();
  return {
    ...actual,
    getEmbeddingEngine: (): never => {
      throw new Error('engine must not be called on adopt');
    },
  };
});

const enqueueSpy = vi.fn();
vi.mock('../../src/knowledge/start-ingestion.js', () => ({
  enqueueDocument: (id: string) => enqueueSpy(id),
}));

import { CODEC_VERSION, EMBED_DIM, MODEL_ID, encode } from '@chatsundere/embeddings';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import {
  KNOWLEDGE_COLLECTION,
  _resetKnowledgeVectorsForTests,
  getKnowledgeVectorStore,
} from '../../src/boot/knowledge-vectors-db.js';
import { importKnowledgePack } from '../../src/data/chatsundere-import.js';
import { writeKnowledgePack } from '../../src/lib/chatsundere-transfer/knowledge-pack.js';

/** Build a minimal knowledge-pack Blob using the specified embed fingerprint. */
async function buildKnowledgePack(opts: {
  modelId?: string;
  dim?: number;
  codecVersion?: number;
}): Promise<Blob> {
  const vector = new Float32Array(EMBED_DIM).fill(0.1);
  const encoded = encode(vector);

  // Build a pack at the local fingerprint by default (→ adopt strategy).
  // Pass mismatched opts to force the reembed strategy.
  const { gzip, tar } = await import('../../src/lib/archive/tar-write.js');
  const enc = new TextEncoder();
  const manifest = {
    format: 'chatsundere/knowledge',
    version: 1,
    exportedAt: '',
    appVersion: '',
    embed: {
      modelId: opts.modelId ?? MODEL_ID,
      dim: opts.dim ?? EMBED_DIM,
      codecVersion: opts.codecVersion ?? CODEC_VERSION,
    },
    source: { libraryName: 'Science' },
  };
  const library = { name: 'Science', description: 'test', nsfw: false, createdAt: 1, updatedAt: 1 };
  const documents = [
    {
      id: 'doc-1',
      libraryId: 'lib-src',
      title: 'Photosynthesis',
      content: 'Plants convert sunlight to energy.',
      embeddingStatus: 'ready',
      embeddingError: null,
      chunkCount: 1,
      triggerPhrases: [],
      createdAt: 1,
      updatedAt: 1,
    },
  ];
  // Serialise the vector using the embeddings codec so the adopt path can deserialise it.
  const { serialise } = await import('@chatsundere/embeddings');
  const vecBytes = serialise(encoded);
  const sidecar = [
    {
      documentId: 'doc-1',
      chunkIndex: 0,
      headingPath: [],
      text: 'Plants convert sunlight to energy.',
      byteOffset: 0,
      byteLength: vecBytes.length,
    },
  ];

  const files = [
    { name: 'manifest.json', bytes: enc.encode(JSON.stringify(manifest)) },
    { name: 'library.json', bytes: enc.encode(JSON.stringify(library)) },
    { name: 'documents.json', bytes: enc.encode(JSON.stringify(documents)) },
    { name: 'vectors.json', bytes: enc.encode(JSON.stringify(sidecar)) },
    { name: 'vectors.bin', bytes: vecBytes },
  ];
  const gz: Uint8Array<ArrayBuffer> = new Uint8Array(await gzip(tar(files)));
  return new Blob([gz], { type: 'application/gzip' });
}

describe('importKnowledgePack — adopt path', () => {
  beforeEach(async () => {
    enqueueSpy.mockClear();
    await _resetClientDataDbForTests();
    await openClientDataDb();
    await _resetKnowledgeVectorsForTests();
  });

  afterEach(async () => {
    await _resetClientDataDbForTests();
    await _resetKnowledgeVectorsForTests();
  });

  it('sets documents ready and upserts vectors without calling the engine', async () => {
    const blob = await buildKnowledgePack({});
    const { libraryId } = await importKnowledgePack(blob, 'Science (imported)');

    const db = getClientDataDb();
    const lib = await db.libraries.get(libraryId);
    expect(lib?.name).toBe('Science (imported)');

    const docs = await db.documents.where('libraryId').equals(libraryId).toArray();
    expect(docs).toHaveLength(1);
    expect(docs[0]?.embeddingStatus).toBe('ready');
    expect(docs[0]?.chunkCount).toBe(1);

    // Vector should be in the store under the new document id
    const newDocId = docs[0]?.id ?? '';
    const store = getKnowledgeVectorStore();
    const rows = await store.scan({
      collection: KNOWLEDGE_COLLECTION,
      filter: { tags: { documentId: newDocId } },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.tags.libraryId).toBe(libraryId);

    // Engine was not called (mock throws if called)
    expect(enqueueSpy).not.toHaveBeenCalled();
  });

  it('assigns a fresh libraryId distinct from the source', async () => {
    const blob = await buildKnowledgePack({});
    const { libraryId } = await importKnowledgePack(blob, 'Science');
    // Source library id was 'lib-src'; importer must not reuse it
    expect(libraryId).not.toBe('lib-src');
  });
});

describe('importKnowledgePack — reembed path', () => {
  beforeEach(async () => {
    enqueueSpy.mockClear();
    await _resetClientDataDbForTests();
    await openClientDataDb();
    await _resetKnowledgeVectorsForTests();
  });

  afterEach(async () => {
    await _resetClientDataDbForTests();
    await _resetKnowledgeVectorsForTests();
  });

  it('sets documents pending and enqueues each for re-embedding', async () => {
    // Mismatched modelId forces the reembed strategy
    const blob = await buildKnowledgePack({ modelId: 'old-model-v0' });
    const { libraryId } = await importKnowledgePack(blob, 'Science (reembed)');

    const db = getClientDataDb();
    const docs = await db.documents.where('libraryId').equals(libraryId).toArray();
    expect(docs).toHaveLength(1);
    expect(docs[0]?.embeddingStatus).toBe('pending');

    // enqueueDocument was called exactly once (per document)
    expect(enqueueSpy).toHaveBeenCalledTimes(1);
    expect(enqueueSpy).toHaveBeenCalledWith(docs[0]?.id);
  });
});
