import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
// apps/user-client/tests/component/knowledge-library.test.tsx
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { libsMock, createMock, updateMock, deleteMock, adultMock, docsMock } = vi.hoisted(() => ({
  libsMock: vi.fn(),
  createMock: vi.fn(() => ({ mutateAsync: vi.fn() })),
  updateMock: vi.fn(() => ({ mutateAsync: vi.fn() })),
  deleteMock: vi.fn(() => ({ mutate: vi.fn() })),
  adultMock: vi.fn(() => ({ mode: 'nsfw' })),
  docsMock: vi.fn(() => ({ data: [] })),
}));
vi.mock('../../src/data/knowledge.js', () => ({
  useLibraries: () => libsMock(),
  useCreateLibrary: () => createMock(),
  useUpdateLibrary: () => updateMock(),
  useDeleteLibrary: () => deleteMock(),
  useDocuments: () => docsMock(),
  useAddDocuments: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('../../src/data/settings.js', () => ({ useAdultMode: () => adultMock() }));
vi.mock('../../src/content/help/use-help.js', () => ({
  useHelp: () => ({ onHelp: vi.fn(), helpOverlay: null }),
}));

import { KnowledgeLibraryPage } from '../../src/routes/app/knowledge/library.js';

function wrapAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/app/knowledge" element={<div>list screen</div>} />
        <Route path="/app/knowledge/new" element={<KnowledgeLibraryPage />} />
        <Route path="/app/knowledge/:libraryId" element={<KnowledgeLibraryPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  libsMock.mockReturnValue({
    data: [
      { id: 'a', name: 'Lore', description: 'World', nsfw: false, createdAt: 1, updatedAt: 1 },
    ],
    isLoading: false,
  });
  adultMock.mockReturnValue({ mode: 'nsfw' });
});

describe('KnowledgeLibraryPage', () => {
  it('create mode offers a name field and an explicit Create action', () => {
    wrapAt('/app/knowledge/new');
    expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /create/i })).toBeInTheDocument();
  });

  it('edit mode seeds the inline name field from the loaded library', () => {
    wrapAt('/app/knowledge/a');
    expect(screen.getByDisplayValue('Lore')).toBeInTheDocument();
  });

  it('shows a calm notice for an unknown library id', () => {
    wrapAt('/app/knowledge/zzz');
    expect(screen.getByText(/can.?t find that library/i)).toBeInTheDocument();
  });

  it('disables the NSFW toggle with a reason in SFW mode', () => {
    adultMock.mockReturnValue({ mode: 'sfw' });
    wrapAt('/app/knowledge/a');
    expect(screen.getByRole('button', { name: /adult library/i })).toBeDisabled();
    expect(screen.getByText(/switch to nsfw mode/i)).toBeInTheDocument();
  });
});
