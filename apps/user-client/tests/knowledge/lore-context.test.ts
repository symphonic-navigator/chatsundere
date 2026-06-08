// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import type { DocumentRow, LibraryRow } from '../../src/boot/client-data-db.js';
import { buildLoreContext } from '../../src/knowledge/lore-context.js';

function lib(p: Partial<LibraryRow>): LibraryRow {
  return {
    id: 'L1',
    name: 'Story',
    description: '',
    nsfw: false,
    createdAt: 1,
    updatedAt: 1,
    ...p,
  };
}
function docRow(p: Partial<DocumentRow>): DocumentRow {
  return {
    id: 'd',
    libraryId: 'L1',
    title: 'Red Dragon',
    content: 'The red dragon guards the valley.',
    embeddingStatus: 'ready',
    embeddingError: null,
    chunkCount: 1,
    triggerPhrases: ['red dragon'],
    triggerOnCompanion: false,
    createdAt: 1,
    updatedAt: 1,
    ...p,
  };
}

const persona = { adultPersona: false, libraryIds: ['L1'] };
const chat = { libraryIds: [] as string[] };

describe('buildLoreContext', () => {
  it('returns formatted lore + result when a phrase fires in an assigned library', async () => {
    const deps = {
      listLibraries: async () => [lib({})],
      listDocumentsInLibraries: async () => [docRow({})],
    };
    const out = await buildLoreContext(
      persona,
      chat,
      'about the red dragon',
      null,
      new Set(),
      deps,
    );
    expect(out).not.toBeNull();
    expect(out?.loreContext).toContain('[Story › Red Dragon]');
    expect(out?.lore.entries).toHaveLength(1);
  });

  it('returns null when the library is not assigned (scope is the safety valve)', async () => {
    const deps = {
      listLibraries: async () => [lib({})],
      listDocumentsInLibraries: async () => [docRow({})],
    };
    const out = await buildLoreContext(
      { adultPersona: false, libraryIds: [] },
      chat,
      'red dragon',
      null,
      new Set(),
      deps,
    );
    expect(out).toBeNull();
  });

  it('returns null when nothing matches', async () => {
    const deps = {
      listLibraries: async () => [lib({})],
      listDocumentsInLibraries: async () => [docRow({})],
    };
    const out = await buildLoreContext(
      persona,
      chat,
      'let us talk about the weather',
      null,
      new Set(),
      deps,
    );
    expect(out).toBeNull();
  });

  it('NSFW library is excluded for a SFW persona', async () => {
    const deps = {
      listLibraries: async () => [lib({ nsfw: true })],
      listDocumentsInLibraries: async () => [docRow({})],
    };
    const out = await buildLoreContext(persona, chat, 'red dragon', null, new Set(), deps);
    expect(out).toBeNull();
  });

  it('fires from the preceding companion message only when the document opts in', async () => {
    const deps = {
      listLibraries: async () => [lib({})],
      listDocumentsInLibraries: async () => [docRow({ triggerOnCompanion: true })],
    };
    const out = await buildLoreContext(
      persona,
      chat,
      'and then?',
      'The red dragon rose up.',
      new Set(),
      deps,
    );
    expect(out).not.toBeNull();
    expect(out?.lore.entries).toHaveLength(1);
  });

  it('does NOT fire from companion text when the document has not opted in', async () => {
    const deps = {
      listLibraries: async () => [lib({})],
      listDocumentsInLibraries: async () => [docRow({ triggerOnCompanion: false })],
    };
    const out = await buildLoreContext(
      persona,
      chat,
      'and then?',
      'The red dragon rose up.',
      new Set(),
      deps,
    );
    expect(out).toBeNull();
  });

  it('returns null when the only matching document is on cooldown', async () => {
    const deps = {
      listLibraries: async () => [lib({})],
      listDocumentsInLibraries: async () => [docRow({ id: 'd' })],
    };
    const out = await buildLoreContext(persona, chat, 'red dragon', null, new Set(['d']), deps);
    expect(out).toBeNull();
  });
});
