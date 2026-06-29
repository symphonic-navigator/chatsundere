// @vitest-environment node
import { encode } from '@chatsundere/embeddings';
import { describe, expect, it } from 'vitest';
import {
  type KnowledgePackPayload,
  readKnowledgePack,
  writeKnowledgePack,
} from '../../../src/lib/chatsundere-transfer/knowledge-pack.js';

function vec(seed: number): Float32Array {
  const v = new Float32Array(768);
  for (let i = 0; i < v.length; i++) v[i] = Math.sin(seed + i);
  return v;
}

function payload(): KnowledgePackPayload {
  return {
    library: { name: 'Lore', description: 'd', nsfw: false, createdAt: 1, updatedAt: 2 },
    documents: [
      {
        id: 'doc-1',
        libraryId: 'lib-1',
        title: 'T',
        content: 'body',
        embeddingStatus: 'ready',
        embeddingError: null,
        chunkCount: 1,
        triggerPhrases: ['x'],
        triggerOnCompanion: false,
        createdAt: 1,
        updatedAt: 2,
      },
    ],
    vectors: [
      {
        documentId: 'doc-1',
        chunkIndex: 0,
        headingPath: ['T'],
        text: 'body',
        encoded: encode(vec(1)),
      },
    ],
  };
}

describe('knowledge-pack', () => {
  it('round-trips library + documents + vectors', async () => {
    const p = payload();
    const blob = await writeKnowledgePack(p);
    const { manifest, payload: out } = await readKnowledgePack(blob);
    expect(manifest.format).toBe('chatsundere/knowledge');
    expect(manifest.embed).toEqual({
      modelId: 'Snowflake/snowflake-arctic-embed-m-v2.0',
      dim: 768,
      codecVersion: 1,
    });
    expect(out.library).toEqual(p.library);
    expect(out.documents).toEqual(p.documents);
    expect(out.vectors[0]?.documentId).toBe('doc-1');
    expect(out.vectors[0]?.text).toBe('body');
    expect(out.vectors[0]?.encoded.codes).toEqual(p.vectors[0]?.encoded.codes);
  });

  it('round-trips multiple vectors at distinct byte offsets', async () => {
    const v1 = encode(vec(1));
    const v2 = encode(vec(2));

    const multi: KnowledgePackPayload = {
      library: { name: 'Lore', description: 'd', nsfw: false, createdAt: 1, updatedAt: 2 },
      documents: [
        {
          id: 'doc-1',
          libraryId: 'lib-1',
          title: 'T1',
          content: 'body one',
          embeddingStatus: 'ready',
          embeddingError: null,
          chunkCount: 1,
          triggerPhrases: [],
          triggerOnCompanion: false,
          createdAt: 1,
          updatedAt: 2,
        },
        {
          id: 'doc-2',
          libraryId: 'lib-1',
          title: 'T2',
          content: 'body two',
          embeddingStatus: 'ready',
          embeddingError: null,
          chunkCount: 1,
          triggerPhrases: [],
          triggerOnCompanion: false,
          createdAt: 3,
          updatedAt: 4,
        },
      ],
      vectors: [
        { documentId: 'doc-1', chunkIndex: 0, headingPath: ['T1'], text: 'body one', encoded: v1 },
        { documentId: 'doc-2', chunkIndex: 0, headingPath: ['T2'], text: 'body two', encoded: v2 },
      ],
    };

    const blob = await writeKnowledgePack(multi);
    const { payload: out } = await readKnowledgePack(blob);

    // First vector — sanity check.
    expect(out.vectors[0]?.documentId).toBe('doc-1');
    expect(out.vectors[0]?.text).toBe('body one');
    expect(out.vectors[0]?.encoded.codes).toEqual(v1.codes);

    // Second vector — proves the reader sliced vectors.bin at the correct non-zero
    // byte offset rather than re-reading from the start (which would yield v1's codes).
    expect(out.vectors[1]?.documentId).toBe('doc-2');
    expect(out.vectors[1]?.text).toBe('body two');
    expect(out.vectors[1]?.encoded.codes).toEqual(v2.codes);
    expect(out.vectors[1]?.encoded.codes).not.toEqual(v1.codes);
  });
});
