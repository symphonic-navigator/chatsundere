// apps/user-client/tests/component/knowledge-document.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { docsMock, addMock, updateMock, deleteMock, retryMock } = vi.hoisted(() => ({
  docsMock: vi.fn(),
  addMock: vi.fn(),
  updateMock: vi.fn(),
  deleteMock: vi.fn(() => ({ mutate: vi.fn() })),
  retryMock: vi.fn(() => ({ mutate: vi.fn() })),
}));
vi.mock('../../src/data/knowledge.js', () => ({
  useDocuments: () => docsMock(),
  useAddDocuments: () => ({ mutateAsync: addMock }),
  useUpdateDocument: () => ({ mutateAsync: updateMock }),
  useDeleteDocument: () => deleteMock(),
  useRetryDocument: () => retryMock(),
  useLibraries: () => ({
    data: [{ id: 'a', name: 'Lore', description: '', nsfw: false, createdAt: 1, updatedAt: 1 }],
  }),
}));
vi.mock('../../src/content/help/use-help.js', () => ({
  useHelp: () => ({ onHelp: vi.fn(), helpOverlay: null }),
}));
vi.mock('../../src/components/knowledge/ModelDownloadBanner.js', () => ({
  ModelDownloadBanner: () => null,
}));

import { KnowledgeDocumentPage } from '../../src/routes/app/knowledge/document.js';

const READY_DOC = {
  id: 'd1',
  libraryId: 'a',
  title: 'Map',
  content: 'old body',
  embeddingStatus: 'ready',
  embeddingError: null,
  chunkCount: 1,
  triggerPhrases: ['atlas'],
  triggerOnCompanion: false,
  createdAt: 1,
  updatedAt: 1,
};
const FAILED_DOC = {
  ...READY_DOC,
  id: 'd2',
  title: 'Bad',
  embeddingStatus: 'failed',
  embeddingError: 'embed boom',
};

function wrapAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/app/knowledge/:libraryId" element={<div>library screen</div>} />
        <Route path="/app/knowledge/:libraryId/new" element={<KnowledgeDocumentPage />} />
        <Route path="/app/knowledge/:libraryId/:documentId" element={<KnowledgeDocumentPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  docsMock.mockReturnValue({ data: [READY_DOC, FAILED_DOC], isLoading: false });
  addMock.mockResolvedValue(['new-id']);
  updateMock.mockResolvedValue(undefined);
});

describe('KnowledgeDocumentPage', () => {
  it('edit mode seeds title and content from the loaded document', () => {
    wrapAt('/app/knowledge/a/d1');
    expect(screen.getByDisplayValue('Map')).toBeInTheDocument();
    expect(screen.getByDisplayValue('old body')).toBeInTheDocument();
  });

  it('a title-only edit saves without sending content (no re-embed)', async () => {
    const user = userEvent.setup();
    wrapAt('/app/knowledge/a/d1');
    const title = screen.getByDisplayValue('Map');
    await user.clear(title);
    await user.type(title, 'Atlas');
    await user.click(screen.getByRole('button', { name: /^save$/i }));
    expect(updateMock).toHaveBeenCalledWith({
      id: 'd1',
      patch: expect.not.objectContaining({ content: expect.anything() }),
    });
    expect(updateMock).toHaveBeenCalledWith({
      id: 'd1',
      patch: expect.objectContaining({ title: 'Atlas' }),
    });
  });

  it('a content edit includes content in the patch (re-embed)', async () => {
    const user = userEvent.setup();
    wrapAt('/app/knowledge/a/d1');
    const body = screen.getByDisplayValue('old body');
    await user.clear(body);
    await user.type(body, 'new body');
    await user.click(screen.getByRole('button', { name: /^save$/i }));
    expect(updateMock).toHaveBeenCalledWith({
      id: 'd1',
      patch: expect.objectContaining({ content: 'new body' }),
    });
  });

  it('shows the failure cause and a Retry control on a failed document', () => {
    wrapAt('/app/knowledge/a/d2');
    expect(screen.getByText(/embed boom/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('disables the companion toggle with a reason when there are no phrases', () => {
    docsMock.mockReturnValue({ data: [{ ...READY_DOC, triggerPhrases: [] }], isLoading: false });
    wrapAt('/app/knowledge/a/d1');
    expect(screen.getByRole('button', { name: /let the companion trigger this/i })).toBeDisabled();
    expect(screen.getByText(/add a trigger phrase first/i)).toBeInTheDocument();
  });

  it('create mode adds the document then saves phrases, and offers Save', async () => {
    const user = userEvent.setup();
    wrapAt('/app/knowledge/a/new');
    await user.type(screen.getByLabelText(/title/i), 'Fresh');
    await user.type(screen.getByLabelText(/content/i), 'fresh body');
    await user.click(screen.getByRole('button', { name: /^save$/i }));
    expect(addMock).toHaveBeenCalledWith([{ title: 'Fresh', content: 'fresh body' }]);
  });
});
