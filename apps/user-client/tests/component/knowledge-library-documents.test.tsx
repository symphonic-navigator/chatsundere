import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
// apps/user-client/tests/component/knowledge-library-documents.test.tsx
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { libsMock, docsMock, addMock } = vi.hoisted(() => ({
  libsMock: vi.fn(),
  docsMock: vi.fn(),
  addMock: vi.fn(() => ({ mutateAsync: vi.fn() })),
}));
vi.mock('../../src/data/knowledge.js', () => ({
  useLibraries: () => libsMock(),
  useCreateLibrary: () => ({ mutateAsync: vi.fn() }),
  useUpdateLibrary: () => ({ mutateAsync: vi.fn() }),
  useDeleteLibrary: () => ({ mutate: vi.fn() }),
  useDocuments: () => docsMock(),
  useAddDocuments: () => addMock(),
}));
vi.mock('../../src/data/settings.js', () => ({ useAdultMode: () => ({ mode: 'nsfw' }) }));
vi.mock('../../src/content/help/use-help.js', () => ({
  useHelp: () => ({ onHelp: vi.fn(), helpOverlay: null }),
}));
vi.mock('../../src/components/knowledge/ModelDownloadBanner.js', () => ({
  ModelDownloadBanner: () => null,
}));

import { KnowledgeLibraryPage } from '../../src/routes/app/knowledge/library.js';

function wrap() {
  return render(
    <MemoryRouter initialEntries={['/app/knowledge/a']}>
      <Routes>
        <Route path="/app/knowledge" element={<div>list</div>} />
        <Route path="/app/knowledge/:libraryId" element={<KnowledgeLibraryPage />} />
        <Route path="/app/knowledge/:libraryId/new" element={<div>new doc</div>} />
        <Route path="/app/knowledge/:libraryId/:documentId" element={<div>doc</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  libsMock.mockReturnValue({
    data: [{ id: 'a', name: 'Lore', description: '', nsfw: false, createdAt: 1, updatedAt: 1 }],
    isLoading: false,
  });
});

describe('Library detail — documents section', () => {
  it('shows the empty state when the library has no documents', () => {
    docsMock.mockReturnValue({ data: [] });
    wrap();
    expect(screen.getByText(/no documents yet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add/i })).toBeInTheDocument();
  });

  it('renders a row per document with its status badge', () => {
    docsMock.mockReturnValue({
      data: [
        {
          id: 'd1',
          libraryId: 'a',
          title: 'Map',
          content: 'x',
          embeddingStatus: 'ready',
          embeddingError: null,
          chunkCount: 1,
          triggerPhrases: [],
          createdAt: 1,
          updatedAt: 1,
        },
        {
          id: 'd2',
          libraryId: 'a',
          title: 'Lore',
          content: 'y',
          embeddingStatus: 'failed',
          embeddingError: 'boom',
          chunkCount: 0,
          triggerPhrases: [],
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });
    wrap();
    expect(screen.getByText('Map')).toBeInTheDocument();
    expect(screen.getByText(/ready/i)).toBeInTheDocument();
    expect(screen.getByText(/failed/i)).toBeInTheDocument();
  });

  it('shows the offending filename in the upload-error notice when a file is empty', async () => {
    const user = userEvent.setup();
    docsMock.mockReturnValue({ data: [] });
    wrap();
    const uploadInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const emptyFile = new File([' '], 'notes.md', { type: 'text/markdown' });
    await user.upload(uploadInput, emptyFile);
    expect(await screen.findByText(/Could not read:.*notes\.md/)).toBeInTheDocument();
  });
});
