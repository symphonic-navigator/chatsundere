// SPDX-License-Identifier: AGPL-3.0-only
import { vi } from 'vitest';

vi.mock('../../../src/content/help/use-help.js', () => ({
  useHelp: vi.fn(() => ({ onHelp: vi.fn(), helpOverlay: null })),
}));

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../../src/boot/client-data-db.js';
import { createProject, stat, writeText } from '../../../src/projects/fs.js';
import { ProjectTreePage } from '../../../src/routes/app/projects/tree.js';
import { toastStore, useToastStore } from '../../../src/state/toast.store.js';

function Where(): JSX.Element {
  const l = useLocation();
  return <p data-testid="where">{`${l.pathname}${l.search}`}</p>;
}

function renderTree(projectId: string) {
  return render(
    <MemoryRouter initialEntries={[`/app/projects/${projectId}`]}>
      <Routes>
        <Route path="/app/projects/:projectId" element={<ProjectTreePage />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

function ToastProbe(): JSX.Element {
  const toasts = useToastStore((s) => s.toasts);
  return <p data-testid="toasts">{toasts.map((t) => t.message).join('|')}</p>;
}

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
  toastStore.clear();
  sessionStorage.clear();
});

async function choose(trigger: string, item: string): Promise<void> {
  fireEvent.click(await screen.findByLabelText(trigger));
  fireEvent.click(await screen.findByRole('menuitem', { name: item }));
}

describe('ProjectTreePage', () => {
  it('shows every file and dims dotfiles', async () => {
    const p = await createProject('P');
    await writeText(p.id, '/notes/a.md', 'a');
    await writeText(p.id, '/.secret.md', 'b');
    renderTree(p.id);
    const hidden = await screen.findByTestId('tree-row-/.secret.md');
    expect(hidden.className).toContain('opacity-50');
    expect(screen.getByTestId('tree-row-/notes/a.md').className).not.toContain('opacity-50');
  });

  it('collapses a directory and remembers it in sessionStorage', async () => {
    const p = await createProject('P');
    await writeText(p.id, '/notes/a.md', 'a');
    renderTree(p.id);
    fireEvent.click(await screen.findByRole('button', { name: /^▾ notes\/$/ }));
    expect(screen.queryByTestId('tree-row-/notes/a.md')).toBeNull();
    expect(sessionStorage.getItem(`projects.tree.${p.id}`)).toContain('/notes');
  });

  it('shows the empty state', async () => {
    const p = await createProject('P');
    renderTree(p.id);
    expect(await screen.findByText('No files yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New file' })).toBeInTheDocument();
  });

  it('creates /todo as /todo.md and opens it in edit mode', async () => {
    const p = await createProject('P');
    renderTree(p.id);
    fireEvent.click(await screen.findByRole('button', { name: 'New file' }));
    const input = screen.getByPlaceholderText('e.g. /notes/plan.md — folders are created for you.');
    expect((input as HTMLInputElement).value).toBe('/');
    fireEvent.change(input, { target: { value: '/todo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByTestId('where')).toHaveTextContent(
      `/app/projects/${p.id}/file?path=${encodeURIComponent('/todo.md')}&edit=1`,
    );
    expect(await stat(p.id, '/todo.md')).not.toBeNull();
  });

  it('refuses /x.txt inline and keeps the dialog open', async () => {
    const p = await createProject('P');
    renderTree(p.id);
    fireEvent.click(await screen.findByRole('button', { name: 'New file' }));
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. \/notes/), {
      target: { value: '/x.txt' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Projects hold Markdown files (.md) for now.',
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(await stat(p.id, '/x.txt')).toBeNull();
  });

  it('prefills the directory path for New file here', async () => {
    const p = await createProject('P');
    await writeText(p.id, '/notes/a.md', 'a');
    renderTree(p.id);
    await choose('Actions for /notes', 'New file here');
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('/notes/');
  });

  it('renaming a directory moves its files', async () => {
    const p = await createProject('P');
    await writeText(p.id, '/notes/a.md', 'a');
    await writeText(p.id, '/notes/b.md', 'b');
    renderTree(p.id);
    await choose('Actions for /notes', 'Rename / Move');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '/ideas' } });
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    await waitFor(async () => {
      expect(await stat(p.id, '/ideas/a.md')).not.toBeNull();
      expect(await stat(p.id, '/ideas/b.md')).not.toBeNull();
    });
    expect(await screen.findByTestId('tree-row-/ideas/a.md')).toBeInTheDocument();
  });

  it('renames a file with the .md rule', async () => {
    const p = await createProject('P');
    await writeText(p.id, '/a.md', 'a');
    renderTree(p.id);
    await choose('Actions for /a.md', 'Rename / Move');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '/b' } });
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    await waitFor(async () => expect(await stat(p.id, '/b.md')).not.toBeNull());
  });

  it('labels the confirm "Rename" for a new name and "Move" for a new folder', async () => {
    const p = await createProject('P');
    await writeText(p.id, '/notes/a.md', 'a');
    renderTree(p.id);
    await choose('Actions for /notes/a.md', 'Rename / Move');
    const input = screen.getByRole('textbox');
    expect(screen.getByRole('button', { name: 'Rename' })).toBeInTheDocument();
    fireEvent.change(input, { target: { value: '/notes/b' } });
    expect(screen.getByRole('button', { name: 'Rename' })).toBeInTheDocument();
    fireEvent.change(input, { target: { value: '/archive/a.md' } });
    expect(screen.getByRole('button', { name: 'Move' })).toBeInTheDocument();
    fireEvent.change(input, { target: { value: '/a' } });
    fireEvent.click(screen.getByRole('button', { name: 'Move' }));
    await waitFor(async () => expect(await stat(p.id, '/a.md')).not.toBeNull());
  });

  it('deleting a folder shows the folder toast', async () => {
    const p = await createProject('P');
    await writeText(p.id, '/notes/a.md', 'a');
    await writeText(p.id, '/notes/b.md', 'b');
    render(
      <>
        <ToastProbe />
        <MemoryRouter initialEntries={[`/app/projects/${p.id}`]}>
          <Routes>
            <Route path="/app/projects/:projectId" element={<ProjectTreePage />} />
          </Routes>
        </MemoryRouter>
      </>,
    );
    await choose('Actions for /notes', 'Delete');
    await waitFor(() =>
      expect(screen.getByTestId('toasts')).toHaveTextContent(
        'Moved notes/ (2 files) to Recently deleted',
      ),
    );
    expect(await getClientDataDb().projectFiles.count()).toBe(0);
  });

  it('encodes # and ? in the file link', async () => {
    const p = await createProject('P');
    await writeText(p.id, '/a #1?.md', 'a');
    renderTree(p.id);
    fireEvent.click(await screen.findByRole('button', { name: 'a #1?.md' }));
    expect(await screen.findByTestId('where')).toHaveTextContent(
      `/app/projects/${p.id}/file?path=${encodeURIComponent('/a #1?.md')}`,
    );
    expect(encodeURIComponent('/a #1?.md')).toBe('%2Fa%20%231%3F.md');
  });
});
