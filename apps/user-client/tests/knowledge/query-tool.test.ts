import { describe, expect, it, vi } from 'vitest';
import {
  contributeKnowledgeTools,
  renderKnowledgeAwareness,
} from '../../src/knowledge/query-tool.js';
import type { RetrievedChunk } from '../../src/knowledge/retrieval.js';

const ctx = (hits: RetrievedChunk[]) => ({
  libraries: [{ id: 'a', name: 'Farblehre', description: 'colour notes' }],
  retrieve: vi.fn(async () => hits),
});

describe('contributeKnowledgeTools', () => {
  it('returns no tool when there are no libraries', () => {
    expect(contributeKnowledgeTools({ libraries: [], retrieve: vi.fn() })).toEqual([]);
  });

  it('contributes query_knowledgebase with a query param', () => {
    const [tool] = contributeKnowledgeTools(ctx([]));
    expect(tool?.name).toBe('query_knowledgebase');
    expect(tool?.parameters).toMatchObject({ required: ['query'] });
  });

  it('formats hits with provenance', async () => {
    const [tool] = contributeKnowledgeTools(
      ctx([
        {
          libraryName: 'Farblehre',
          documentTitle: 'Grundlagen',
          headingPath: ['Farbkraft'],
          text: 'Chunk text',
          score: 0.57,
        },
      ]),
    );
    // biome-ignore lint/style/noNonNullAssertion: a tool is guaranteed when libraries are present
    const res = await tool!.execute({ query: 'farbkraft' });
    expect(res.ok).toBe(true);
    expect(res.output).toContain('Farblehre');
    expect(res.output).toContain('Grundlagen');
    expect(res.output).toContain('Farbkraft');
    expect(res.output).toContain('Chunk text');
    expect(res.output).toContain('0.57');
  });

  it('returns a constructive message when nothing matches', async () => {
    const [tool] = contributeKnowledgeTools(ctx([]));
    // biome-ignore lint/style/noNonNullAssertion: a tool is guaranteed when libraries are present
    const res = await tool!.execute({ query: 'nope' });
    expect(res.ok).toBe(true);
    expect(res.output).toContain('No relevant passages');
  });

  it('returns an error result when retrieve throws', async () => {
    const c = {
      libraries: [{ id: 'a', name: 'A', description: '' }],
      retrieve: vi.fn(async () => {
        throw new Error('engine down');
      }),
    };
    const [tool] = contributeKnowledgeTools(c);
    // biome-ignore lint/style/noNonNullAssertion: a tool is guaranteed when libraries are present
    const res = await tool!.execute({ query: 'x' });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('engine down');
  });
});

describe('renderKnowledgeAwareness', () => {
  it('lists names and descriptions', () => {
    const text = renderKnowledgeAwareness([
      { id: 'a', name: 'Farblehre', description: 'colour notes' },
      { id: 'b', name: 'Reise-Japan', description: 'travel docs' },
    ]);
    expect(text).toContain('query_knowledgebase');
    expect(text).toContain('Farblehre');
    expect(text).toContain('colour notes');
    expect(text).toContain('Reise-Japan');
  });

  it('returns empty string for no libraries', () => {
    expect(renderKnowledgeAwareness([])).toBe('');
  });
});
