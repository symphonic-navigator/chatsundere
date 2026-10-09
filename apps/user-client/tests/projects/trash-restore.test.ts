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
import { listRevisions, sweepOrphanRevisions } from '../../src/projects/revisions.js';
import { deletePath, deleteProject } from '../../src/projects/trash.js';
import { listTrashCards, purgeCard, restoreCard } from '../../src/trash/trash-repo.js';

let db: ClientDataDb;

beforeEach(async () => {
  await _resetClientDataDbForTests();
  db = await openClientDataDb();
});

afterEach(() => {
  vi.useRealTimers();
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

/** Writes a second version so the file carries one revision. */
async function withHistory(pid: string, path: string): Promise<string> {
  await writeText(pid, path, `second ${path}`);
  return (await stat(pid, path))?.id ?? '';
}

async function revisionCount(fileId: string): Promise<number> {
  return db.projectRevisions.where('fileId').equals(fileId).count();
}

describe('restoreCard on a file card', () => {
  it('restores under a new id at the same path with content and re-keyed revisions', async () => {
    const pid = await seed(['/notes/plan.md']);
    const oldId = await withHistory(pid, '/notes/plan.md');
    expect(await revisionCount(oldId)).toBe(1);
    const before = (await db.projects.get(pid))?.updatedAt ?? 0;
    const res = await deletePath(pid, '/notes/plan.md');

    await restoreCard(res.cardKey);

    const meta = await stat(pid, '/notes/plan.md');
    expect(meta).not.toBeNull();
    expect(meta?.id).not.toBe(oldId);
    expect(meta?.projectId).toBe(pid);
    expect((await readText(pid, '/notes/plan.md')).text).toBe('second /notes/plan.md');
    expect(await revisionCount(meta?.id ?? '')).toBe(1);
    expect(await revisionCount(oldId)).toBe(0);
    expect(await listRevisions(pid, '/notes/plan.md')).toHaveLength(1);
    expect(await db.projectContents.get(oldId)).toBeUndefined();
    expect(await db.trash.count()).toBe(0);
    expect((await db.projects.get(pid))?.updatedAt ?? 0).toBeGreaterThanOrEqual(before);
    expect(await db.syncOutbox.count()).toBe(0);
  });
});

describe('restoreCard on a folder (batch) card', () => {
  it('restores every member into the live project without the batch marker', async () => {
    const pid = await seed(['/notes/a.md', '/notes/deep/b.md', '/keep.md']);
    const oldA = await withHistory(pid, '/notes/a.md');
    const res = await deletePath(pid, '/notes');
    expect(res.cardKey).toMatch(/^batch:/);

    await restoreCard(res.cardKey);

    const a = await stat(pid, '/notes/a.md');
    const b = await stat(pid, '/notes/deep/b.md');
    expect(a?.id).not.toBe(oldA);
    expect(b).not.toBeNull();
    expect(a && 'batch' in a).toBe(false);
    expect((await readText(pid, '/notes/deep/b.md')).text).toBe('text of /notes/deep/b.md');
    expect(await revisionCount(a?.id ?? '')).toBe(1);
    expect(await revisionCount(oldA)).toBe(0);
    expect(await db.projectFiles.count()).toBe(3);
    expect(await db.trash.count()).toBe(0);
  });
});

describe('restoreCard on a project card', () => {
  it('keeps the live-at-delete path and renames the earlier-deleted duplicate', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 8, 10));
    const pid = await seed(['/a.md', '/b.md'], 'Project X');
    const earlierId = await withHistory(pid, '/a.md');
    await deletePath(pid, '/a.md');
    vi.setSystemTime(new Date(2026, 9, 8, 11));
    await writeText(pid, '/a.md', 'new a');
    await deleteProject(pid);
    vi.setSystemTime(new Date(2026, 9, 9, 9));

    await restoreCard(`projects:${pid}`);

    const projects = await db.projects.toArray();
    expect(projects).toHaveLength(1);
    const restored = projects[0];
    expect(restored?.id).not.toBe(pid);
    expect(restored?.name).toBe('Project X');
    expect(restored?.updatedAt).toBe(new Date(2026, 9, 9, 9).getTime());
    const npid = restored?.id ?? '';
    expect((await readText(npid, '/a.md')).text).toBe('new a');
    expect((await readText(npid, '/a (restored 2026-10-09).md')).text).toBe('second /a.md');
    expect((await readText(npid, '/b.md')).text).toBe('text of /b.md');
    const renamed = await stat(npid, '/a (restored 2026-10-09).md');
    expect(await revisionCount(renamed?.id ?? '')).toBe(1);
    expect(await revisionCount(earlierId)).toBe(0);
    expect(await db.projectFiles.count()).toBe(3);
    expect(await db.projectContents.count()).toBe(3);
    expect(await db.trash.count()).toBe(0);
    expect(await db.syncOutbox.count()).toBe(0);
  });

  it('adds a numeric suffix when the restored name is taken too', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 9, 8));
    const pid = await seed(['/a.md', '/a (restored 2026-10-09).md']);
    await deletePath(pid, '/a.md');
    vi.setSystemTime(new Date(2026, 9, 9, 9));
    await writeText(pid, '/a.md', 'second a');
    await deletePath(pid, '/a.md');
    vi.setSystemTime(new Date(2026, 9, 9, 10));
    await writeText(pid, '/a.md', 'third a');
    await deleteProject(pid);

    await restoreCard(`projects:${pid}`);

    const [project] = await db.projects.toArray();
    const npid = project?.id ?? '';
    const paths = (await db.projectFiles.toArray()).map((f) => f.path).sort();
    expect(paths).toEqual([
      '/a (restored 2026-10-09) 2.md',
      '/a (restored 2026-10-09) 3.md',
      '/a (restored 2026-10-09).md',
      '/a.md',
    ]);
    expect((await readText(npid, '/a.md')).text).toBe('third a');
    expect((await readText(npid, '/a (restored 2026-10-09).md')).text).toBe(
      'text of /a (restored 2026-10-09).md',
    );
    expect((await readText(npid, '/a (restored 2026-10-09) 2.md')).text).toBe('second a');
    expect((await readText(npid, '/a (restored 2026-10-09) 3.md')).text).toBe('text of /a.md');
  });
});

describe('restoreCard onto a live collision', () => {
  it('rejects with AlreadyExists, changes nothing and keeps the card', async () => {
    const pid = await seed(['/notes/a.md', '/notes/b.md', '/notes/c.md']);
    const oldB = await withHistory(pid, '/notes/b.md');
    const res = await deletePath(pid, '/notes');
    await writeText(pid, '/notes/b.md', 'new b');
    await writeText(pid, '/notes/c.md', 'new c');
    const files = await db.projectFiles.toArray();
    const revisions = await db.projectRevisions.toArray();
    const project = await db.projects.get(pid);

    const e = await expectFsError(restoreCard(res.cardKey), 'AlreadyExists');
    expect((e as { detail: { path: string; others: number } }).detail).toMatchObject({
      path: '/notes/b.md',
      others: 1,
    });

    expect(await db.projectFiles.toArray()).toEqual(files);
    expect(await db.projectRevisions.toArray()).toEqual(revisions);
    expect(await db.projects.get(pid)).toEqual(project);
    expect(await revisionCount(oldB)).toBe(1);
    expect(await db.trash.count()).toBe(6);
    expect((await listTrashCards()).map((c) => c.cardKey)).toEqual([res.cardKey]);
  });
});

describe('purgeCard', () => {
  it('drops the purged files revisions and leaves other projects alone', async () => {
    const gone = await seed(['/a.md']);
    const goneId = await withHistory(gone, '/a.md');
    const kept = await seed(['/a.md']);
    const keptId = await withHistory(kept, '/a.md');
    const res = await deleteProject(gone);

    await purgeCard(res.cardKey);

    expect(await revisionCount(goneId)).toBe(0);
    expect(await revisionCount(keptId)).toBe(1);
  });
});

describe('sweepOrphanRevisions', () => {
  it('keeps revisions of live and trashed files and removes the rest', async () => {
    const pid = await seed(['/live.md', '/trashed.md']);
    const liveId = await withHistory(pid, '/live.md');
    const trashedId = await withHistory(pid, '/trashed.md');
    await deletePath(pid, '/trashed.md');
    await db.projectRevisions.put({
      fileId: 'orphan',
      version: 'v1',
      text: 'x',
      size: 1,
      createdAt: 1,
    });

    expect(await sweepOrphanRevisions()).toBe(1);

    expect(await revisionCount(liveId)).toBe(1);
    expect(await revisionCount(trashedId)).toBe(1);
    expect(await revisionCount('orphan')).toBe(0);
    expect(await sweepOrphanRevisions()).toBe(0);
  });
});
