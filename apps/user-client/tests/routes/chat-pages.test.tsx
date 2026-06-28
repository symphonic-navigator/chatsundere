// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ArtefactsPage } from '../../src/routes/app/chat/artefacts-page.js';
import { BookmarksPage } from '../../src/routes/app/chat/bookmarks-page.js';
import { KnowledgePage } from '../../src/routes/app/chat/knowledge-page.js';

vi.mock('../../src/content/help/use-help.js', () => ({
  useHelp: () => ({ onHelp: vi.fn(), helpOverlay: null }),
}));

// ArtefactsPage calls artefact hooks — stub them so the crumb smoke-test
// does not need a QueryClientProvider.
vi.mock('../../src/data/artefacts.js', () => ({
  useChatArtefacts: () => ({ data: [] }),
  useSetArtefactFavourite: () => ({ mutate: vi.fn() }),
  useRenameArtefact: () => ({ mutate: vi.fn() }),
  useUpdateArtefactContent: () => ({ mutate: vi.fn() }),
  useDeleteArtefact: () => ({ mutate: vi.fn() }),
  useSetArtefactTags: () => ({ mutate: vi.fn() }),
}));

// BookmarksPage now calls useChat / useToggleBookmark — stub them so
// the crumb smoke-test does not need a QueryClientProvider.
// KnowledgePage also calls useSetChatLibraries — include it in the same mock.
vi.mock('../../src/data/chats.js', () => ({
  useChat: vi.fn(() => ({ data: null })),
  useToggleBookmark: vi.fn(() => ({ mutateAsync: vi.fn() })),
  useSetChatLibraries: vi.fn(() => ({ mutate: vi.fn() })),
}));

// KnowledgePage calls useFilteredLibraries — return an empty list so the
// smoke-test can render without a QueryClientProvider.
vi.mock('../../src/data/knowledge.js', () => ({
  useFilteredLibraries: () => ({ data: [] }),
}));

// KnowledgePage calls usePersona — return null (chat not loaded in this test).
vi.mock('../../src/data/personas.js', () => ({
  usePersona: () => ({ data: null }),
}));

vi.mock('../../src/data/bookmarks.js', () => ({
  useSetBookmarkLabel: vi.fn(() => ({ mutateAsync: vi.fn() })),
}));

it('bookmarks page renders its crumb', () => {
  render(
    <MemoryRouter initialEntries={['/app/chat/c1/bookmarks']}>
      <Routes>
        <Route path="/app/chat/:chatId/bookmarks" element={<BookmarksPage />} />
      </Routes>
    </MemoryRouter>,
  );
  // "Bookmarks" now appears as both the crumb and the page H1.
  expect(screen.getAllByText('Bookmarks').length).toBeGreaterThan(0);
});

describe('chat page stubs — crumbs', () => {
  it('artefacts page renders its crumb', () => {
    render(
      <MemoryRouter initialEntries={['/app/chat/c1/artefacts']}>
        <Routes>
          <Route path="/app/chat/:chatId/artefacts" element={<ArtefactsPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getAllByText('Artefacts').length).toBeGreaterThan(0);
  });

  it('knowledge page renders its crumb', () => {
    render(
      <MemoryRouter initialEntries={['/app/chat/c1/knowledge']}>
        <Routes>
          <Route path="/app/chat/:chatId/knowledge" element={<KnowledgePage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getAllByText('Knowledge').length).toBeGreaterThan(0);
  });
});
