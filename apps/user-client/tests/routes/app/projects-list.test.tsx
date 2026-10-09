// SPDX-License-Identifier: AGPL-3.0-only
import { vi } from 'vitest';

vi.mock('../../../src/content/help/use-help.js', () => ({
  useHelp: vi.fn(() => ({ onHelp: vi.fn(), helpOverlay: null })),
}));

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../../src/boot/client-data-db.js';
import { fsError } from '../../../src/projects/errors.js';
import { createProject, writeText } from '../../../src/projects/fs.js';
import { PathDialog } from '../../../src/routes/app/projects/PathDialog.js';
import { ProjectsListPage } from '../../../src/routes/app/projects/list.js';
import { toastStore, useToastStore } from '../../../src/state/toast.store.js';

interface StorageMock {
  persisted: ReturnType<typeof vi.fn>;
  persist: ReturnType<typeof vi.fn>;
  estimate: ReturnType<typeof vi.fn>;
}

function mockStorage(opts: { persisted: boolean } | null): StorageMock | null {
  if (opts === null) {
    Object.defineProperty(navigator, 'storage', { configurable: true, value: undefined });
    return null;
  }
  const mock: StorageMock = {
    persisted: vi.fn(async () => opts.persisted),
    persist: vi.fn(async () => false),
    estimate: vi.fn(async () => ({ usage: 12 * 1024 * 1024, quota: 2 * 1024 * 1024 * 1024 })),
  };
  Object.defineProperty(navigator, 'storage', { configurable: true, value: mock });
  return mock;
}

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
  toastStore.clear();
});

afterEach(() => {
  Object.defineProperty(navigator, 'storage', { configurable: true, value: undefined });
});

function renderList() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/app/projects']}>
        <Routes>
          <Route path="/app/projects" element={<ProjectsListPage />} />
          <Route path="/app/projects/:projectId" element={<p>Project page</p>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('ProjectsListPage', () => {
  it('lists projects with their file counts', async () => {
    mockStorage({ persisted: true });
    const a = await createProject('Novel');
    await writeText(a.id, '/one.md', 'a');
    await writeText(a.id, '/notes/two.md', 'b');
    await createProject('Empty');
    renderList();
    expect(await screen.findByText('Novel')).toBeInTheDocument();
    expect(screen.getByText('Empty')).toBeInTheDocument();
    expect(await screen.findByText(/^2 files/)).toBeInTheDocument();
    expect(screen.getByText(/^0 files/)).toBeInTheDocument();
  });

  it('requests persistence once after New project when not yet persisted', async () => {
    const storage = mockStorage({ persisted: false });
    renderList();
    fireEvent.click(await screen.findByRole('button', { name: 'New project' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Plans' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    expect(await screen.findByText('Project page')).toBeInTheDocument();
    expect(storage?.persist).toHaveBeenCalledTimes(1);
    const rows = await getClientDataDb().projects.toArray();
    expect(rows.map((r) => r.name)).toEqual(['Plans']);
  });

  it('does not request persistence when storage is already persistent', async () => {
    const storage = mockStorage({ persisted: true });
    renderList();
    fireEvent.click(await screen.findByRole('button', { name: 'New project' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Plans' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    expect(await screen.findByText('Project page')).toBeInTheDocument();
    expect(storage?.persist).not.toHaveBeenCalled();
  });

  it('shows the persistent storage line and usage', async () => {
    mockStorage({ persisted: true });
    renderList();
    expect(await screen.findByText('Storage is persistent')).toBeInTheDocument();
    expect(
      await screen.findByText('Chatsundere uses 12 MB of about 2 GB available'),
    ).toBeInTheDocument();
    expect(screen.getByText('Projects live on this device only for now.')).toBeInTheDocument();
  });

  it('shows no persistence line until the first read completes', async () => {
    const storage = mockStorage({ persisted: true });
    let resolve: (v: boolean) => void = () => undefined;
    storage?.persisted.mockImplementation(
      () =>
        new Promise<boolean>((r) => {
          resolve = r;
        }),
    );
    renderList();
    expect(
      await screen.findByText('Projects live on this device only for now.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/The browser may clear this data/)).toBeNull();
    expect(screen.queryByText('Storage is persistent')).toBeNull();
    resolve(true);
    expect(await screen.findByText('Storage is persistent')).toBeInTheDocument();
    expect(screen.queryByText(/The browser may clear this data/)).toBeNull();
  });

  it('shows the may-clear line when storage is not persistent', async () => {
    mockStorage({ persisted: false });
    renderList();
    expect(
      await screen.findByText(
        'The browser may clear this data when space runs low — export projects you care about.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('Storage is persistent')).toBeNull();
  });

  it('shows the may-clear line and no usage when the storage API is missing', async () => {
    mockStorage(null);
    renderList();
    expect(
      await screen.findByText(
        'The browser may clear this data when space runs low — export projects you care about.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Chatsundere uses/)).toBeNull();
    expect(screen.getByText('Projects live on this device only for now.')).toBeInTheDocument();
  });

  it('deletes from the row menu and shows the undo toast', async () => {
    mockStorage({ persisted: true });
    await createProject('Doomed');
    renderList();
    await screen.findByText('Doomed');
    fireEvent.click(screen.getByRole('button', { name: 'More actions' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByText('Doomed')).toBeNull());
    const toast = useToastStore.getState().toasts.at(-1);
    expect(toast?.action?.label).toBe('Undo');
    expect(await getClientDataDb().projects.count()).toBe(0);
  });
});

describe('PathDialog', () => {
  function renderDialog(onSubmit: (path: string) => Promise<void>) {
    return render(
      <PathDialog
        title="New file"
        initial="/"
        confirmLabel="Create"
        onSubmit={onSubmit}
        onClose={() => undefined}
      />,
    );
  }

  it('appends .md and submits the normalised path', async () => {
    const onSubmit = vi.fn(async (_path: string) => undefined);
    renderDialog(onSubmit);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '/notes//plan' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith('/notes/plan.md'));
  });

  it('refuses another extension inline and keeps the input', async () => {
    const onSubmit = vi.fn(async (_path: string) => undefined);
    renderDialog(onSubmit);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '/a.txt' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Projects hold Markdown files (.md) for now.',
    );
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox')).toHaveValue('/a.txt');
  });

  it('shows a thrown AlreadyExists in plain words and stays open', async () => {
    renderDialog(async (path) => {
      throw fsError('AlreadyExists', { path });
    });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '/a.md' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'A file already exists at that path.',
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue('/a.md');
  });
});
