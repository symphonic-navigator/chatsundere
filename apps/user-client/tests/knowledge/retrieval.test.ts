import { describe, expect, it, vi } from 'vitest';
import { retrieveFromLibraries } from '../../src/knowledge/retrieval.js';

const deps = {
  embed: vi.fn(async () => [new Float32Array([1, 0, 0])]),
  query: vi.fn(async ({ filter }: { filter: { tags: { libraryId: string } } }) => {
    const id = filter.tags.libraryId;
    if (id === 'a')
      return [
        {
          id: 'doc1#0',
          score: 0.9,
          numeric: { chunkIndex: 0 },
          metadata: { text: 'TA', headingPath: ['H'] },
        },
      ];
    if (id === 'b')
      return [
        {
          id: 'doc2#1',
          score: 0.5,
          numeric: { chunkIndex: 1 },
          metadata: { text: 'TB', headingPath: [] },
        },
      ];
    return [];
  }),
  getDocumentTitle: vi.fn(async (docId: string) => (docId === 'doc1' ? 'Doc One' : 'Doc Two')),
};

describe('retrieveFromLibraries', () => {
  it('merges hits across libraries, sorted by score, with provenance', async () => {
    const libs = [
      { id: 'a', name: 'LibA', description: '' },
      { id: 'b', name: 'LibB', description: '' },
    ];
    const hits = await retrieveFromLibraries(deps, libs, 'q', {
      topK: 6,
      minScore: 0.3,
      candidateK: 24,
    });
    expect(hits).toEqual([
      { libraryName: 'LibA', documentTitle: 'Doc One', headingPath: ['H'], text: 'TA', score: 0.9 },
      { libraryName: 'LibB', documentTitle: 'Doc Two', headingPath: [], text: 'TB', score: 0.5 },
    ]);
    expect(deps.embed).toHaveBeenCalledWith(['q'], { kind: 'query' });
  });

  it('applies the global topK after merge', async () => {
    const libs = [
      { id: 'a', name: 'LibA', description: '' },
      { id: 'b', name: 'LibB', description: '' },
    ];
    const hits = await retrieveFromLibraries(deps, libs, 'q', {
      topK: 1,
      minScore: 0.3,
      candidateK: 24,
    });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.libraryName).toBe('LibA');
  });

  it('returns [] for no libraries without embedding', async () => {
    const localEmbed = vi.fn();
    const hits = await retrieveFromLibraries({ ...deps, embed: localEmbed }, [], 'q', {
      topK: 6,
      minScore: 0.3,
      candidateK: 24,
    });
    expect(hits).toEqual([]);
    expect(localEmbed).not.toHaveBeenCalled();
  });
});
