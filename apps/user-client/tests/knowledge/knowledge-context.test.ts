import { describe, expect, it, vi } from 'vitest';
import type { ChatRow, PersonaRow } from '../../src/boot/client-data-db.js';
import { buildKnowledgeContext } from '../../src/knowledge/knowledge-context.js';

const persona = (libraryIds: string[], adult = true) =>
  ({ id: 'p', adultPersona: adult, libraryIds }) as unknown as PersonaRow;
const chat = (libraryIds: string[]) => ({ id: 'c', libraryIds }) as unknown as ChatRow;

const lib = (id: string, nsfw = false) => ({
  id,
  name: id,
  description: '',
  nsfw,
  createdAt: 0,
  updatedAt: 0,
});

describe('buildKnowledgeContext', () => {
  it('returns null when the effective set is empty', async () => {
    const deps = {
      listLibraries: vi.fn(async () => [lib('a')]),
      embed: vi.fn(),
      query: vi.fn(),
      getDocumentTitle: vi.fn(),
    };
    const out = await buildKnowledgeContext(persona([]), chat([]), deps);
    expect(out).toBeNull();
  });

  it('builds a context over the union, NSFW-filtered', async () => {
    const deps = {
      listLibraries: vi.fn(async () => [lib('a'), lib('x', true)]),
      embed: vi.fn(async () => [new Float32Array([1])]),
      query: vi.fn(async () => []),
      getDocumentTitle: vi.fn(async () => 't'),
    };
    const out = await buildKnowledgeContext(persona(['a', 'x'], false), chat([]), deps);
    expect(out?.libraries.map((l) => l.id)).toEqual(['a']);
    expect(typeof out?.retrieve).toBe('function');
  });
});
