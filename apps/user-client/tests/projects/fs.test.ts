// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type ClientDataDb,
  _resetClientDataDbForTests,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { isProjectFsError } from '../../src/projects/errors.js';
import {
  createProject,
  getProject,
  list,
  listProjects,
  mapQuota,
  readText,
  renameProject,
  sha256B64Url,
  stat,
  statById,
  writeText,
} from '../../src/projects/fs.js';

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

describe('projects', () => {
  it('creates, gets and renames a project with a trimmed name', async () => {
    const p = await createProject('  Garden  ');
    expect(p.name).toBe('Garden');
    expect(await getProject(p.id)).toEqual(p);
    await renameProject(p.id, ' Allotment ');
    expect((await getProject(p.id))?.name).toBe('Allotment');
  });

  it('names an empty project "Untitled project"', async () => {
    expect((await createProject('   ')).name).toBe('Untitled project');
  });

  it('refuses to rename a missing project', async () => {
    await expectFsError(renameProject('nope', 'x'), 'NotFound');
  });

  it('lists projects by updatedAt descending, bumped by file writes', async () => {
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(1000);
    const a = await createProject('A');
    now.mockReturnValue(2000);
    const b = await createProject('B');
    expect((await listProjects()).map((p) => p.id)).toEqual([b.id, a.id]);
    now.mockReturnValue(3000);
    await writeText(a.id, '/x.md', 'hi');
    expect((await listProjects()).map((p) => p.id)).toEqual([a.id, b.id]);
    expect((await getProject(a.id))?.updatedAt).toBe(3000);
  });
});

describe('files', () => {
  it('derives directories from file paths', async () => {
    const p = await createProject('P');
    const meta = await writeText(p.id, '/notes/plan.md', '# Plan');
    expect(await list(p.id, '/')).toEqual([{ type: 'dir', path: '/notes' }]);
    expect(await list(p.id, '/', { recursive: true })).toEqual([{ type: 'file', meta }]);
    expect(await list(p.id, '/notes')).toEqual([{ type: 'file', meta }]);
    expect(await stat(p.id, '/notes/plan.md')).toEqual(meta);
    expect(await statById(meta.id)).toEqual(meta);
    expect(await stat(p.id, '/notes/other.md')).toBeNull();
    expect(meta.size).toBe(6);
    expect(meta.kind).toBe('markdown');
  });

  it('normalises paths on write and read', async () => {
    const p = await createProject('P');
    await writeText(p.id, '/a//b/./c.md', 'x');
    expect((await readText(p.id, '/a/b/c.md')).text).toBe('x');
    await expectFsError(writeText(p.id, '/a/b/c.txt', 'x'), 'InvalidPath');
  });

  it('sorts directories first, then names by code point; mtime by updatedAt desc', async () => {
    const p = await createProject('P');
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(10);
    await writeText(p.id, '/b.md', 'b');
    now.mockReturnValue(20);
    await writeText(p.id, '/a.md', 'a');
    now.mockReturnValue(30);
    await writeText(p.id, '/Z.md', 'z');
    await writeText(p.id, '/zdir/x.md', 'x');
    await writeText(p.id, '/adir/x.md', 'x');
    const names = async (sort?: 'name' | 'mtime') =>
      (await list(p.id, '/', sort ? { sort } : {})).map((e) =>
        e.type === 'dir' ? `d:${e.path}` : e.meta.path,
      );
    expect(await names()).toEqual(['d:/adir', 'd:/zdir', '/Z.md', '/a.md', '/b.md']);
    expect(await names('mtime')).toEqual(['d:/adir', 'd:/zdir', '/Z.md', '/a.md', '/b.md']);
    now.mockReturnValue(40);
    await writeText(p.id, '/b.md', 'newer');
    expect(await names('mtime')).toEqual(['d:/adir', 'd:/zdir', '/b.md', '/Z.md', '/a.md']);
    expect(await names('name')).toEqual(['d:/adir', 'd:/zdir', '/Z.md', '/a.md', '/b.md']);
  });

  it('hides dotfiles unless includeHidden', async () => {
    const p = await createProject('P');
    const meta = await writeText(p.id, '/.ideas.md', 'secret');
    await writeText(p.id, '/.hidden/x.md', 'x');
    expect(await list(p.id, '/')).toEqual([]);
    expect(await list(p.id, '/', { recursive: true })).toEqual([]);
    expect(await list(p.id, '/', { includeHidden: true })).toEqual([
      { type: 'dir', path: '/.hidden' },
      { type: 'file', meta },
    ]);
  });

  it('enforces file/directory exclusivity', async () => {
    const p = await createProject('P');
    await writeText(p.id, '/notes/plan.md', 'x');
    await expectFsError(writeText(p.id, '/notes', 'y'), 'IsDirectory');
    await expectFsError(writeText(p.id, '/notes', 'y', { ifVersion: 'v' }), 'IsDirectory');
    await expectFsError(writeText(p.id, '/notes/plan.md/x.md', 'y'), 'NotDirectory');
    await expectFsError(list(p.id, '/notes/plan.md'), 'NotDirectory');
    await expectFsError(list(p.id, '/nope'), 'NotFound');
    await expectFsError(writeText(p.id, '/', 'y'), 'InvalidPath');
    await expectFsError(writeText(p.id, '/other', 'y'), 'InvalidPath');
    expect(await stat(p.id, '/notes')).toBeNull();
    expect(await list(p.id, '/', { recursive: true })).toHaveLength(1);
  });

  it('lists an empty root without error', async () => {
    const p = await createProject('P');
    expect(await list(p.id, '/')).toEqual([]);
  });

  it('refuses writes into a missing project', async () => {
    await expectFsError(writeText('missing', '/a.md', 'x'), 'NotFound');
    expect(await db.projectFiles.count()).toBe(0);
  });

  it('applies createOnly and ifVersion', async () => {
    const p = await createProject('P');
    const meta = await writeText(p.id, '/a.md', 'old');
    await expectFsError(writeText(p.id, '/a.md', 'new', { createOnly: true }), 'AlreadyExists');
    const e = await expectFsError(
      writeText(p.id, '/a.md', 'new', { ifVersion: 'stale' }),
      'VersionConflict',
    );
    expect((e as { detail: { current: string; passed: string } }).detail).toMatchObject({
      current: meta.version,
      passed: 'stale',
      path: '/a.md',
    });
    expect((await readText(p.id, '/a.md')).text).toBe('old');
    await expectFsError(writeText(p.id, '/b.md', 'x', { ifVersion: meta.version }), 'NotFound');
    expect(await stat(p.id, '/b.md')).toBeNull();
    const next = await writeText(p.id, '/a.md', 'new', { ifVersion: meta.version });
    expect(next.version).not.toBe(meta.version);
    expect(next.id).toBe(meta.id);
    expect(next.createdAt).toBe(meta.createdAt);
    expect((await readText(p.id, '/a.md')).text).toBe('new');
  });

  it('treats identical content as a no-op', async () => {
    const p = await createProject('P');
    const meta = await writeText(p.id, '/a.md', 'same');
    const again = await writeText(p.id, '/a.md', 'same');
    expect(again).toEqual(meta);
    expect(await db.projectRevisions.count()).toBe(0);
  });

  it('readText of a missing path is NotFound', async () => {
    const p = await createProject('P');
    await expectFsError(readText(p.id, '/a.md'), 'NotFound');
  });

  it('never reads content in list or stat', async () => {
    const p = await createProject('P');
    await writeText(p.id, '/notes/plan.md', 'x');
    await writeText(p.id, '/top.md', 'y');
    const table = db.projectContents;
    const spies = (
      ['get', 'bulkGet', 'toArray', 'where', 'toCollection', 'each', 'filter', 'orderBy'] as const
    ).map((m) => vi.spyOn(table, m));
    let hookReads = 0;
    const reading = (obj: unknown) => {
      hookReads++;
      return obj;
    };
    table.hook('reading', reading);
    const calls = () => spies.reduce((n, s) => n + s.mock.calls.length, 0) + hookReads;

    await list(p.id, '/');
    await list(p.id, '/', { recursive: true });
    await list(p.id, '/notes', { sort: 'mtime' });
    await stat(p.id, '/top.md');
    const meta = await stat(p.id, '/notes/plan.md');
    await statById(meta?.id ?? '');
    expect(calls()).toBe(0);

    // Positive control: the detectors do see a content read.
    await readText(p.id, '/top.md');
    expect(calls()).toBeGreaterThan(0);
    expect(hookReads).toBeGreaterThan(0);
    table.hook('reading').unsubscribe(reading);
  });

  it('round-trips a 5 MB file and stores its 5 MB revision', async () => {
    const p = await createProject('P');
    const big = 'a'.repeat(5 * 1024 * 1024);
    const first = await writeText(p.id, '/big.md', big);
    expect(first.size).toBe(5 * 1024 * 1024);
    expect((await readText(p.id, '/big.md')).text).toBe(big);
    const bigger = `${big}b`;
    await writeText(p.id, '/big.md', bigger);
    expect((await readText(p.id, '/big.md')).text).toBe(bigger);
    const revs = await db.projectRevisions.where('fileId').equals(first.id).toArray();
    expect(revs).toHaveLength(1);
    expect(revs[0]?.version).toBe(first.version);
    expect(revs[0]?.size).toBe(5 * 1024 * 1024);
    expect(revs[0]?.text).toBe(big);
  });

  it('detects a stale write from a second connection', async () => {
    const p = await createProject('P');
    const v1 = await writeText(p.id, '/a.md', 'one');

    // A second tab: a fresh module graph with its own Dexie connection.
    vi.resetModules();
    const dbB = await import('../../src/boot/client-data-db.js');
    const fsB = await import('../../src/projects/fs.js');
    const connB = await dbB.openClientDataDb();
    expect(connB).not.toBe(db);

    const v2 = await writeText(p.id, '/a.md', 'two', { ifVersion: v1.version });
    let caught: unknown;
    try {
      await fsB.writeText(p.id, '/a.md', 'stale', { ifVersion: v1.version });
    } catch (e) {
      caught = e;
    }
    expect(caught).toMatchObject({ code: 'VersionConflict', detail: { current: v2.version } });
    expect((await fsB.readText(p.id, '/a.md')).text).toBe('two');
    expect((await readText(p.id, '/a.md')).text).toBe('two');
    connB.close();
  });
});

describe('helpers', () => {
  it('hashes to unpadded base64url SHA-256', async () => {
    expect(await sha256B64Url(new TextEncoder().encode('abc'))).toBe(
      'ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0',
    );
  });

  it('maps quota failures, including Dexie-wrapped ones, to QuotaExceeded', async () => {
    const quota = { name: 'QuotaExceededError', message: 'full' };
    await expectFsError(mapQuota(Promise.reject(quota)), 'QuotaExceeded');
    await expectFsError(
      mapQuota(Promise.reject({ name: 'AbortError', inner: quota })),
      'QuotaExceeded',
    );
    const other = new Error('boom');
    await expect(mapQuota(Promise.reject(other))).rejects.toBe(other);
    await expect(mapQuota(Promise.resolve(7))).resolves.toBe(7);
  });
});
