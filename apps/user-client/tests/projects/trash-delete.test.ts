// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type ClientDataDb,
  _resetClientDataDbForTests,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { isProjectFsError } from '../../src/projects/errors.js';
import { createProject, readText, stat, writeText } from '../../src/projects/fs.js';
import { deletePath, deleteProject } from '../../src/projects/trash.js';
import { listTrashCards, purgeCard, restoreCard } from '../../src/trash/trash-repo.js';

let db: ClientDataDb;

beforeEach(async () => {
  await _resetClientDataDbForTests();
  db = await openClientDataDb();
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function expectFsError(p: Promise<unknown>, code: string): Promise<unknown> {
  try {
    await p;
  } catch (e) {
    expect(isProjectFsError(e)).toBe(true);
    expect((e as { code: string }).code).toBe(code);
    return e;
  }
  throw new Error(`expected ${code}, but the call resolved`);
}

async function seed(paths: string[], name = 'P'): Promise<string> {
  const p = await createProject(name);
  for (const path of paths) await writeText(p.id, path, `text of ${path}`);
  return p.id;
}

describe('deletePath on a file', () => {
  it('moves meta and content into the trash as one file card', async () => {
    const pid = await seed(['/notes/plan.md', '/other.md']);
    const meta = await stat(pid, '/notes/plan.md');
    const res = await deletePath(pid, '/notes/plan.md');

    expect(await stat(pid, '/notes/plan.md')).toBeNull();
    expect(await db.projectContents.get(meta?.id ?? '')).toBeUndefined();
    expect(await db.trash.count()).toBe(2);
    expect(res.cardKey).toBe(`projectFiles:${meta?.id}`);
    expect(res.message).toBe('Moved to Recently deleted · recoverable for 30 days');

    const cards = await listTrashCards();
    expect(cards).toHaveLength(1);
    expect(cards[0]?.cardKey).toBe(res.cardKey);
    expect(cards[0]?.entityKind).toBe('projectFile');
    expect(cards[0]?.title).toBe('notes/plan.md');
    expect(cards[0]?.counts.files).toBe(1);
    expect(cards[0]?.counts.items).toBe(0);
    expect(cards[0]?.projectName).toBe('P');
  });

  it('refuses the root, a stale version, a version on a folder and a missing path', async () => {
    const pid = await seed(['/notes/a.md']);
    const e = await expectFsError(deletePath(pid, '/'), 'InvalidPath');
    expect((e as { detail: { reason: string } }).detail.reason).toBe('root');
    await expectFsError(deletePath(pid, '/notes/a.md', { ifVersion: 'stale' }), 'VersionConflict');
    await expectFsError(deletePath(pid, '/notes', { ifVersion: 'x' }), 'IsDirectory');
    await expectFsError(deletePath(pid, '/nope.md'), 'NotFound');
    await expectFsError(deletePath('missing', '/a.md'), 'NotFound');
    expect(await db.trash.count()).toBe(0);
  });

  it('accepts the current version', async () => {
    const pid = await seed(['/a.md']);
    const meta = await stat(pid, '/a.md');
    await deletePath(pid, '/a.md', { ifVersion: meta?.version ?? '' });
    expect(await stat(pid, '/a.md')).toBeNull();
  });
});

describe('deletePath on a folder', () => {
  it('makes one batch card for every file below the prefix and leaves look-alikes', async () => {
    const pid = await seed(['/notes/a.md', '/notes/b.md', '/notes/deep/c.md', '/notesX.md']);
    const res = await deletePath(pid, '/notes');

    expect(res.cardKey).toMatch(/^batch:/);
    expect(res.message).toBe('Moved notes/ (3 files) to Recently deleted');
    expect(await stat(pid, '/notesX.md')).not.toBeNull();
    expect(await db.projectFiles.count()).toBe(1);
    expect(await db.trash.count()).toBe(6);

    const cards = await listTrashCards();
    expect(cards).toHaveLength(1);
    expect(cards[0]?.cardKey).toBe(res.cardKey);
    expect(cards[0]?.entityKind).toBe('projectFolder');
    expect(cards[0]?.title).toBe('notes/ — P');
    expect(cards[0]?.counts.files).toBe(3);
  });

  it('says "1 file" for a folder holding a single file', async () => {
    const pid = await seed(['/solo/a.md']);
    const res = await deletePath(pid, '/solo');
    expect(res.message).toBe('Moved solo/ (1 file) to Recently deleted');
  });
});

describe('deleteProject', () => {
  it('moves the project and all its files into one project card', async () => {
    const pid = await seed(['/a.md', '/b/c.md', '/b/d.md'], 'Project X');
    const res = await deleteProject(pid);

    expect(res.cardKey).toBe(`projects:${pid}`);
    expect(await db.projects.get(pid)).toBeUndefined();
    expect(await db.projectFiles.count()).toBe(0);
    expect(await db.projectContents.count()).toBe(0);

    const cards = await listTrashCards();
    expect(cards).toHaveLength(1);
    expect(cards[0]?.entityKind).toBe('project');
    expect(cards[0]?.title).toBe('Project X');
    expect(cards[0]?.counts.files).toBe(3);
    expect(cards[0]?.counts.items).toBe(3);
    expect(cards[0]?.counts.earlierFiles).toBeUndefined();
  });

  it('folds earlier file and folder deletes into the project card', async () => {
    const pid = await seed(['/a.md', '/b/c.md', '/b/d.md', '/e.md']);
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(1_000);
    await deletePath(pid, '/a.md');
    now.mockReturnValue(2_000);
    await deletePath(pid, '/b');
    now.mockReturnValue(3_000);
    await deleteProject(pid);

    const cards = await listTrashCards();
    expect(cards).toHaveLength(1);
    expect(cards[0]?.cardKey).toBe(`projects:${pid}`);
    expect(cards[0]?.counts.files).toBe(4);
    expect(cards[0]?.counts.earlierFiles).toBe(3);
  });

  it('counts one earlier file', async () => {
    const pid = await seed(['/a.md', '/b.md']);
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(1_000);
    await deletePath(pid, '/a.md');
    now.mockReturnValue(2_000);
    await deleteProject(pid);
    const [card] = await listTrashCards();
    expect(card?.counts.earlierFiles).toBe(1);
    expect(card?.counts.files).toBe(2);
  });

  it('shows an empty project as "0 files"', async () => {
    const pid = await seed([]);
    await deleteProject(pid);
    const [card] = await listTrashCards();
    expect(card?.counts.files).toBe(0);
  });

  it('refuses a missing project', async () => {
    await expectFsError(deleteProject('missing'), 'NotFound');
  });
});

describe('undo', () => {
  it('restores a single file in place with the same file id', async () => {
    const pid = await seed(['/notes/plan.md']);
    const id = (await stat(pid, '/notes/plan.md'))?.id;
    const res = await deletePath(pid, '/notes/plan.md');

    await res.handle.restore();

    expect((await stat(pid, '/notes/plan.md'))?.id).toBe(id);
    expect((await readText(pid, '/notes/plan.md')).text).toBe('text of /notes/plan.md');
    expect(await db.trash.count()).toBe(0);
  });

  it('restores a folder in place with the same file ids and clears its trash rows', async () => {
    const pid = await seed(['/notes/a.md', '/notes/b.md']);
    const ids = [(await stat(pid, '/notes/a.md'))?.id, (await stat(pid, '/notes/b.md'))?.id];
    const res = await deletePath(pid, '/notes');
    expect(res.handle.kind).toBe('in-place');

    await res.handle.restore();

    expect((await stat(pid, '/notes/a.md'))?.id).toBe(ids[0]);
    expect((await stat(pid, '/notes/b.md'))?.id).toBe(ids[1]);
    expect((await readText(pid, '/notes/a.md')).text).toBe('text of /notes/a.md');
    expect(await db.trash.count()).toBe(0);
  });

  it('restores a whole project in place', async () => {
    const pid = await seed(['/a.md', '/b/c.md'], 'Keep');
    const res = await deleteProject(pid);
    await res.handle.restore();
    expect((await db.projects.get(pid))?.name).toBe('Keep');
    expect((await readText(pid, '/b/c.md')).text).toBe('text of /b/c.md');
    expect(await db.trash.count()).toBe(0);
  });

  it('refuses when a new file took a path, restoring nothing and keeping the trash', async () => {
    const pid = await seed(['/notes/a.md', '/notes/b.md', '/notes/c.md']);
    const res = await deletePath(pid, '/notes');
    await writeText(pid, '/notes/b.md', 'new b');
    await writeText(pid, '/notes/c.md', 'new c');

    const e = await expectFsError(res.handle.restore(), 'AlreadyExists');
    expect((e as { detail: { path: string; others: number } }).detail).toMatchObject({
      path: '/notes/b.md',
      others: 1,
    });
    expect(await stat(pid, '/notes/a.md')).toBeNull();
    expect((await readText(pid, '/notes/b.md')).text).toBe('new b');
    expect(await db.trash.count()).toBe(6);
  });
});

describe('undo after the card was handled elsewhere', () => {
  it('refuses with NotFound once the card was restored from Recently deleted, adding nothing', async () => {
    const pid = await seed(['/a.md', '/b/c.md'], 'Keep');
    const res = await deleteProject(pid);
    await restoreCard(res.cardKey);
    const projectsBefore = await db.projects.toArray();
    const filesBefore = await db.projectFiles.toArray();

    await expectFsError(res.handle.restore(), 'NotFound');

    expect(await db.projects.toArray()).toEqual(projectsBefore);
    expect(await db.projectFiles.toArray()).toEqual(filesBefore);
    expect(await db.projects.get(pid)).toBeUndefined();
  });

  it('refuses with NotFound once the card was purged, restoring nothing', async () => {
    const pid = await seed(['/notes/a.md', '/notes/b.md']);
    const res = await deletePath(pid, '/notes');
    await purgeCard(res.cardKey);

    await expectFsError(res.handle.restore(), 'NotFound');

    expect(await stat(pid, '/notes/a.md')).toBeNull();
    expect(await db.projectContents.count()).toBe(0);
  });

  it('refuses when only part of the card is gone, keeping the rest in the trash', async () => {
    const pid = await seed(['/a.md']);
    const res = await deletePath(pid, '/a.md');
    const [content] = (await db.trash.toArray()).filter((r) => r.collection === 'projectContents');
    await db.trash.delete(content?.id ?? '');

    await expectFsError(res.handle.restore(), 'NotFound');

    expect(await stat(pid, '/a.md')).toBeNull();
    expect(await db.trash.count()).toBe(1);
  });
});

describe('side effects', () => {
  it('leaves revisions untouched and never writes the sync outbox', async () => {
    const pid = await seed(['/a.md', '/b/c.md']);
    await writeText(pid, '/a.md', 'second');
    const revisionsBefore = await db.projectRevisions.toArray();
    expect(revisionsBefore).toHaveLength(1);

    await deletePath(pid, '/a.md');
    await deletePath(pid, '/b');
    await writeText(pid, '/z.md', 'z');
    const res = await deleteProject(pid);
    await res.handle.restore();

    expect(await db.projectRevisions.toArray()).toEqual(revisionsBefore);
    expect(await db.syncOutbox.count()).toBe(0);
  });
});
