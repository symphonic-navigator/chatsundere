// SPDX-License-Identifier: AGPL-3.0-only
import { vi } from 'vitest';

vi.mock('../../../src/content/help/use-help.js', () => ({
  useHelp: vi.fn(() => ({ onHelp: vi.fn(), helpOverlay: null })),
}));

// The real renderer pulls in shiki/mermaid/KaTeX; its output is not under test here.
vi.mock('../../../src/components/chat/markdown/MarkdownContent.js', () => ({
  MarkdownContent: ({ text }: { text: string }) => <div data-testid="md">{text}</div>,
}));

// Pass-through fs with switches: fail the next writeText, or hold readText until released.
const fsControl = vi.hoisted(() => ({
  failNextWrite: null as unknown,
  failNextRead: null as unknown,
  readGate: null as Promise<void> | null,
}));
vi.mock('../../../src/projects/fs.js', async () => {
  const actual = await vi.importActual<typeof import('../../../src/projects/fs.js')>(
    '../../../src/projects/fs.js',
  );
  return {
    ...actual,
    writeText: (...args: Parameters<typeof actual.writeText>) => {
      const failure = fsControl.failNextWrite;
      if (failure !== null) {
        fsControl.failNextWrite = null;
        return Promise.reject(failure);
      }
      return actual.writeText(...args);
    },
    readText: async (...args: Parameters<typeof actual.readText>) => {
      if (fsControl.readGate) await fsControl.readGate;
      const failure = fsControl.failNextRead;
      if (failure !== null) {
        fsControl.failNextRead = null;
        throw failure;
      }
      return actual.readText(...args);
    },
  };
});

import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../../src/boot/client-data-db.js';
import { fsError } from '../../../src/projects/errors.js';
import { createProject, move, readText, stat, writeText } from '../../../src/projects/fs.js';
import { deletePath } from '../../../src/projects/trash.js';
import { ProjectFilePage } from '../../../src/routes/app/projects/file.js';

function Where(): JSX.Element {
  const l = useLocation();
  return <p data-testid="where">{`${l.pathname}${l.search}`}</p>;
}

const fileUrl = (projectId: string, path: string, edit = false): string =>
  `/app/projects/${projectId}/file?path=${encodeURIComponent(path)}${edit ? '&edit=1' : ''}`;

function renderFile(projectId: string, path: string, edit = false) {
  return render(
    <MemoryRouter initialEntries={[fileUrl(projectId, path, edit)]}>
      <Where />
      <Routes>
        <Route path="/app/projects/:projectId/file" element={<ProjectFilePage />} />
        <Route path="/app/projects/:projectId" element={<p>Tree page</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function editor(): Promise<HTMLTextAreaElement> {
  return (await screen.findByRole('textbox', { name: 'File content' })) as HTMLTextAreaElement;
}

/** Reads the database inside act, so live-query updates it lets through are flushed. */
function settled<T>(read: () => Promise<T>): Promise<T> {
  return act(read);
}

beforeEach(async () => {
  fsControl.failNextWrite = null;
  fsControl.failNextRead = null;
  fsControl.readGate = null;
  await _resetClientDataDbForTests();
  await openClientDataDb();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ProjectFilePage', () => {
  it('renders the file as Markdown in view mode', async () => {
    const p = await createProject('P');
    await writeText(p.id, '/a.md', '# Hello');
    renderFile(p.id, '/a.md');
    expect(await screen.findByTestId('md')).toHaveTextContent('# Hello');
    expect(screen.queryByRole('textbox', { name: 'File content' })).toBeNull();
  });

  it('reloads the view when the file changes elsewhere', async () => {
    const p = await createProject('P');
    await writeText(p.id, '/a.md', 'one');
    renderFile(p.id, '/a.md');
    expect(await screen.findByTestId('md')).toHaveTextContent('one');
    await act(async () => {
      await writeText(p.id, '/a.md', 'two');
    });
    await waitFor(() => expect(screen.getByTestId('md')).toHaveTextContent('two'));
  });

  it('says there is no file at the path, with a link to the project, when nothing is there on entry', async () => {
    const p = await createProject('P');
    renderFile(p.id, '/missing.md');
    expect(
      await screen.findByText(
        'There is no file at /missing.md. It may have been moved or deleted.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('This file was deleted.')).toBeNull();
    fireEvent.click(screen.getByRole('link', { name: 'Back to the project' }));
    expect(await screen.findByText('Tree page')).toBeInTheDocument();
  });

  it('edits and saves, then leaves edit mode', async () => {
    const p = await createProject('P');
    await writeText(p.id, '/a.md', 'old');
    renderFile(p.id, '/a.md');
    await screen.findByTestId('md');
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const box = await editor();
    expect(box.value).toBe('old');
    expect(screen.queryByText('● Unsaved')).toBeNull();
    fireEvent.change(box, { target: { value: 'new' } });
    expect(screen.getByText('● Unsaved')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'File content' })).toBeNull());
    expect(screen.getByTestId('md')).toHaveTextContent('new');
    expect((await settled(() => readText(p.id, '/a.md'))).text).toBe('new');
  });

  it('opens directly in edit mode with ?edit=1', async () => {
    const p = await createProject('P');
    await writeText(p.id, '/a.md', '');
    renderFile(p.id, '/a.md', true);
    expect((await editor()).value).toBe('');
  });

  it('asks before cancelling with changes, and not without', async () => {
    const p = await createProject('P');
    await writeText(p.id, '/a.md', 'keep');
    renderFile(p.id, '/a.md', true);
    await editor();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'File content' })).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(await editor(), { target: { value: 'changed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText('Discard your changes?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect((await editor()).value).toBe('changed');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(screen.getByTestId('md')).toHaveTextContent('keep'));
    expect((await settled(() => readText(p.id, '/a.md'))).text).toBe('keep');
  });

  it('never replaces the buffer with a live change while editing', async () => {
    const p = await createProject('P');
    await writeText(p.id, '/a.md', 'base');
    renderFile(p.id, '/a.md', true);
    fireEvent.change(await editor(), { target: { value: 'mine' } });
    await act(async () => {
      await writeText(p.id, '/a.md', 'theirs');
    });
    await act(() => new Promise((r) => setTimeout(r, 50)));
    expect((await editor()).value).toBe('mine');
  });

  it('on a stale save, Use theirs discards the edit and shows their text', async () => {
    const p = await createProject('P');
    await writeText(p.id, '/a.md', 'base');
    renderFile(p.id, '/a.md', true);
    fireEvent.change(await editor(), { target: { value: 'mine' } });
    await act(async () => {
      await writeText(p.id, '/a.md', 'theirs');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByText(
        'This file changed elsewhere. If you keep yours, the other version stays in History.',
      ),
    ).toBeInTheDocument();
    expect((await editor()).value).toBe('mine');
    fireEvent.click(screen.getByRole('button', { name: 'Use theirs (discard my edit)' }));
    await waitFor(() => expect(screen.getByTestId('md')).toHaveTextContent('theirs'));
    expect(screen.queryByRole('textbox', { name: 'File content' })).toBeNull();
    expect((await settled(() => readText(p.id, '/a.md'))).text).toBe('theirs');
  });

  it('on a stale save, Keep mine saves over the newer version', async () => {
    const p = await createProject('P');
    await writeText(p.id, '/a.md', 'base');
    renderFile(p.id, '/a.md', true);
    fireEvent.change(await editor(), { target: { value: 'mine' } });
    await act(async () => {
      await writeText(p.id, '/a.md', 'theirs');
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Keep mine' }));
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'File content' })).toBeNull());
    expect((await settled(() => readText(p.id, '/a.md'))).text).toBe('mine');
    expect(screen.getByTestId('md')).toHaveTextContent('mine');
  });

  it('follows a move while editing and saves to the new path', async () => {
    const p = await createProject('P');
    await writeText(p.id, '/a.md', 'base');
    renderFile(p.id, '/a.md', true);
    fireEvent.change(await editor(), { target: { value: 'mine' } });
    await act(async () => {
      await move(p.id, '/a.md', '/archive/a.md');
    });
    expect(await screen.findByText('Moved to /archive/a.md.')).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent(fileUrl(p.id, '/archive/a.md'));
    expect((await editor()).value).toBe('mine');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'File content' })).toBeNull());
    expect((await settled(() => readText(p.id, '/archive/a.md'))).text).toBe('mine');
    expect(await settled(() => stat(p.id, '/a.md'))).toBeNull();
  });

  it('keeps the buffer when the file is deleted while editing and saves it as a new file', async () => {
    const p = await createProject('P');
    await writeText(p.id, '/a.md', 'base');
    renderFile(p.id, '/a.md', true);
    fireEvent.change(await editor(), { target: { value: 'mine' } });
    await act(async () => {
      await deletePath(p.id, '/a.md');
    });
    expect(await screen.findByText('This file was deleted.')).toBeInTheDocument();
    expect((await editor()).value).toBe('mine');
    fireEvent.click(screen.getByRole('button', { name: 'Save as new file' }));
    const input = (await screen.findByRole('dialog')).querySelector('input') as HTMLInputElement;
    expect(input.value).toBe('/a.md');
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'File content' })).toBeNull());
    expect((await settled(() => readText(p.id, '/a.md'))).text).toBe('mine');
    expect(await screen.findByTestId('md')).toHaveTextContent('mine');
    expect(screen.queryByText('This file was deleted.')).toBeNull();
  });

  it('Discard after a delete drops the buffer', async () => {
    const p = await createProject('P');
    await writeText(p.id, '/a.md', 'base');
    renderFile(p.id, '/a.md', true);
    fireEvent.change(await editor(), { target: { value: 'mine' } });
    await act(async () => {
      await deletePath(p.id, '/a.md');
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Discard' }));
    const confirm = await screen.findByRole('dialog');
    expect(confirm).toHaveTextContent('Discard your changes?');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Keep editing' }));
    expect((await editor()).value).toBe('mine');
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Discard' }),
    );
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'File content' })).toBeNull());
    expect(screen.getByText('This file was deleted.')).toBeInTheDocument();
  });

  it('Discard after a delete drops an unchanged buffer without asking', async () => {
    const p = await createProject('P');
    await writeText(p.id, '/a.md', 'base');
    renderFile(p.id, '/a.md', true);
    await editor();
    await act(async () => {
      await deletePath(p.id, '/a.md');
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'File content' })).toBeNull());
    expect(screen.queryByText('Discard your changes?')).toBeNull();
    expect(screen.getByText('This file was deleted.')).toBeInTheDocument();
  });

  it('lists revisions newest first, views one and restores it', async () => {
    const p = await createProject('P');
    await writeText(p.id, '/a.md', 'first');
    await writeText(p.id, '/a.md', 'second');
    await writeText(p.id, '/a.md', 'third');
    renderFile(p.id, '/a.md');
    expect(await screen.findByTestId('md')).toHaveTextContent('third');
    fireEvent.click(screen.getByRole('button', { name: /History/ }));
    const items = await screen.findAllByTestId('revision');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('6 B');
    expect(items[1]).toHaveTextContent('5 B');

    fireEvent.click(screen.getAllByRole('button', { name: 'View' })[1] as HTMLElement);
    await waitFor(() => expect(screen.getByTestId('md')).toHaveTextContent('first'));
    fireEvent.click(screen.getByRole('button', { name: 'Back to the current version' }));
    await waitFor(() => expect(screen.getByTestId('md')).toHaveTextContent('third'));

    fireEvent.click(screen.getAllByRole('button', { name: 'Restore' })[1] as HTMLElement);
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Restore' }),
    );
    await waitFor(async () => expect((await readText(p.id, '/a.md')).text).toBe('first'));
    await waitFor(() => expect(screen.getByTestId('md')).toHaveTextContent('first'));
    await waitFor(() => expect(screen.getAllByTestId('revision')).toHaveLength(3));
  });

  it('does not open the editor on text older than the live version', async () => {
    const p = await createProject('P');
    await writeText(p.id, '/a.md', 'base');
    renderFile(p.id, '/a.md');
    expect(await screen.findByTestId('md')).toHaveTextContent('base');
    let release: () => void = () => undefined;
    fsControl.readGate = new Promise<void>((r) => {
      release = r;
    });
    await act(async () => {
      await writeText(p.id, '/a.md', 'theirs');
    });
    const edit = screen.getByRole('button', { name: 'Edit' });
    await waitFor(() => expect(edit).toBeDisabled());
    fireEvent.click(edit);
    expect(screen.queryByRole('textbox', { name: 'File content' })).toBeNull();
    await act(async () => {
      fsControl.readGate = null;
      release();
    });
    await waitFor(() => expect(screen.getByTestId('md')).toHaveTextContent('theirs'));
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect((await editor()).value).toBe('theirs');
  });

  it('a stale edit still conflicts after the view caught up', async () => {
    const p = await createProject('P');
    await writeText(p.id, '/a.md', 'base');
    renderFile(p.id, '/a.md');
    expect(await screen.findByTestId('md')).toHaveTextContent('base');
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    fireEvent.change(await editor(), { target: { value: 'mine' } });
    await act(async () => {
      await writeText(p.id, '/a.md', 'theirs');
    });
    await act(() => new Promise((r) => setTimeout(r, 50)));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByText(
        'This file changed elsewhere. If you keep yours, the other version stays in History.',
      ),
    ).toBeInTheDocument();
    expect((await settled(() => readText(p.id, '/a.md'))).text).toBe('theirs');
  });

  it('shows the quota copy and keeps the buffer when the device is full', async () => {
    const p = await createProject('P');
    await writeText(p.id, '/a.md', 'base');
    renderFile(p.id, '/a.md', true);
    fireEvent.change(await editor(), { target: { value: 'mine' } });
    fsControl.failNextWrite = fsError('QuotaExceeded', { path: '/a.md' });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByText(
        'This device is out of space for projects — export a project to keep a copy, then free some space.',
      ),
    ).toBeInTheDocument();
    expect((await editor()).value).toBe('mine');
    expect(screen.getByText('● Unsaved')).toBeInTheDocument();
  });

  it('keeps the buffer and says so when a save fails for another reason', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const p = await createProject('P');
    await writeText(p.id, '/a.md', 'base');
    renderFile(p.id, '/a.md', true);
    fireEvent.change(await editor(), { target: { value: 'mine' } });
    fsControl.failNextWrite = new Error('disk on fire');
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByText('Could not save — your changes are kept. Try again.'),
    ).toBeInTheDocument();
    expect((await editor()).value).toBe('mine');
    expect(warn).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'File content' })).toBeNull());
    expect((await settled(() => readText(p.id, '/a.md'))).text).toBe('mine');
  });

  it('offers no unguarded way out when the file is deleted while editing', async () => {
    const p = await createProject('P');
    await writeText(p.id, '/a.md', 'base');
    renderFile(p.id, '/a.md', true);
    fireEvent.change(await editor(), { target: { value: 'mine' } });
    await act(async () => {
      await deletePath(p.id, '/a.md');
    });
    expect(await screen.findByText('This file was deleted.')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Back to the project' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    fireEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Discard' }),
    );
    expect(await screen.findByRole('link', { name: 'Back to the project' })).toBeInTheDocument();
  });

  it('warns on reload or tab close only while the edit has unsaved changes', async () => {
    const p = await createProject('P');
    await writeText(p.id, '/a.md', 'base');
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const unloadWarns = (): boolean => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    renderFile(p.id, '/a.md', true);
    const box = await editor();
    expect(unloadWarns()).toBe(false);

    fireEvent.change(box, { target: { value: 'mine' } });
    await waitFor(() =>
      expect(add.mock.calls.some(([type]) => type === 'beforeunload')).toBe(true),
    );
    expect(unloadWarns()).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'File content' })).toBeNull());
    expect(remove.mock.calls.some(([type]) => type === 'beforeunload')).toBe(true);
    expect(unloadWarns()).toBe(false);
  });

  it('shows an earlier version under a banner with Restore and Back, marking its History row', async () => {
    const p = await createProject('P');
    await writeText(p.id, '/a.md', 'first');
    await writeText(p.id, '/a.md', 'second');
    const [rev] = await settled(() => getClientDataDb().projectRevisions.toArray());
    const when = new Date(rev?.createdAt ?? 0).toLocaleString('en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
    renderFile(p.id, '/a.md');
    expect(await screen.findByTestId('md')).toHaveTextContent('second');
    fireEvent.click(screen.getByRole('button', { name: /History/ }));
    const [row] = await screen.findAllByTestId('revision');
    expect(row).not.toHaveAttribute('aria-current');
    fireEvent.click(screen.getByRole('button', { name: 'View' }));

    expect(await screen.findByText(`Version from ${when}`)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('md')).toHaveTextContent('first'));
    expect(screen.getByTestId('revision')).toHaveAttribute('aria-current', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Back to the current version' }));
    await waitFor(() => expect(screen.getByTestId('md')).toHaveTextContent('second'));
    expect(screen.queryByText(`Version from ${when}`)).toBeNull();
    expect(screen.getByTestId('revision')).not.toHaveAttribute('aria-current');

    fireEvent.click(screen.getByRole('button', { name: 'View' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Restore this version' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Restore this version?');
    expect(dialog).toHaveTextContent(`The version from ${when} becomes the current text.`);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Restore' }));
    await waitFor(async () => expect((await readText(p.id, '/a.md')).text).toBe('first'));
    await waitFor(() => expect(screen.queryByText(`Version from ${when}`)).toBeNull());
    await waitFor(() => expect(screen.getByTestId('md')).toHaveTextContent('first'));
  });

  it('says why History is unavailable while editing', async () => {
    const p = await createProject('P');
    await writeText(p.id, '/a.md', 'base');
    renderFile(p.id, '/a.md');
    await screen.findByTestId('md');
    expect(screen.queryByText('Save or cancel your edit first.')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    await editor();
    expect(screen.getByText('Save or cancel your edit first.')).toBeInTheDocument();
  });

  it('offers Retry when the file cannot be read', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const p = await createProject('P');
    await writeText(p.id, '/a.md', 'hello');
    fsControl.failNextRead = new Error('disk on fire');
    renderFile(p.id, '/a.md');
    expect(
      await screen.findByText('Could not load this file. Please try again.'),
    ).toBeInTheDocument();
    expect(warn).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByTestId('md')).toHaveTextContent('hello');
    expect(screen.queryByText('Could not load this file. Please try again.')).toBeNull();
  });
});
