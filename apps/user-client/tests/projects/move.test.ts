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
  _setFaultHookForTests,
  createProject,
  getProject,
  move,
  readText,
  stat,
  writeText,
} from '../../src/projects/fs.js';

let db: ClientDataDb;

beforeEach(async () => {
  await _resetClientDataDbForTests();
  db = await openClientDataDb();
});

afterEach(() => {
  _setFaultHookForTests(null);
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

function detailOf(e: unknown): { path?: string; reason?: string } {
  return (e as { detail: { path?: string; reason?: string } }).detail;
}

async function snapshot(projectId: string) {
  const files = await db.projectFiles.where('projectId').equals(projectId).toArray();
  return {
    files: files
      .map((f) => ({ id: f.id, path: f.path, version: f.version, updatedAt: f.updatedAt }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    projectUpdatedAt: (await getProject(projectId))?.updatedAt,
  };
}

describe('move a file', () => {
  it('renames a file, keeping its id and content, with a new version and updatedAt', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(10);
    const p = await createProject('P');
    const before = await writeText(p.id, '/a.md', 'hello');
    now.mockReturnValue(20);
    await move(p.id, '/a.md', '/notes/b.md');

    expect(await stat(p.id, '/a.md')).toBeNull();
    const { meta, text } = await readText(p.id, '/notes/b.md');
    expect(text).toBe('hello');
    expect(meta.id).toBe(before.id);
    expect(meta.version).not.toBe(before.version);
    expect(meta.updatedAt).toBe(20);
    expect(meta.contentHash).toBe(before.contentHash);
    expect((await getProject(p.id))?.updatedAt).toBe(20);
  });

  it('treats moving a file onto itself as a no-op', async () => {
    const p = await createProject('P');
    const before = await writeText(p.id, '/a.md', 'x');
    const snap = await snapshot(p.id);
    await move(p.id, '/a.md', '/a.md');
    await move(p.id, '/a.md', '//./a.md');
    expect(await snapshot(p.id)).toEqual(snap);
    expect((await stat(p.id, '/a.md'))?.version).toBe(before.version);
  });

  it('honours ifVersion', async () => {
    const p = await createProject('P');
    const meta = await writeText(p.id, '/a.md', 'x');
    const e = await expectFsError(
      move(p.id, '/a.md', '/b.md', { ifVersion: 'stale' }),
      'VersionConflict',
    );
    expect(detailOf(e).path).toBe('/a.md');
    expect(await stat(p.id, '/b.md')).toBeNull();
    await move(p.id, '/a.md', '/b.md', { ifVersion: meta.version });
    expect((await stat(p.id, '/b.md'))?.id).toBe(meta.id);
  });

  it('refuses an existing target file, a folder target, a file ancestor and a bad extension', async () => {
    const p = await createProject('P');
    await writeText(p.id, '/a.md', 'a');
    await writeText(p.id, '/b.md', 'b');
    await writeText(p.id, '/dir/x.md', 'x');
    const snap = await snapshot(p.id);

    const exists = await expectFsError(move(p.id, '/a.md', '/b.md'), 'AlreadyExists');
    expect(detailOf(exists).path).toBe('/b.md');
    const isDir = await expectFsError(move(p.id, '/a.md', '/dir'), 'IsDirectory');
    expect(detailOf(isDir).path).toBe('/dir');
    const notDir = await expectFsError(move(p.id, '/a.md', '/b.md/c.md'), 'NotDirectory');
    expect(detailOf(notDir).path).toBe('/b.md');
    const ext = await expectFsError(move(p.id, '/a.md', '/a.txt'), 'InvalidPath');
    expect(detailOf(ext).reason).toBe('extension');
    await expectFsError(move(p.id, '/a.md', '/'), 'IsDirectory');

    expect(await snapshot(p.id)).toEqual(snap);
  });

  it('reports a missing source and a missing project', async () => {
    const p = await createProject('P');
    const e = await expectFsError(move(p.id, '/nope.md', '/b.md'), 'NotFound');
    expect(detailOf(e).path).toBe('/nope.md');
    const missing = await expectFsError(move('missing', '/a.md', '/b.md'), 'NotFound');
    expect(detailOf(missing).path).toBe('project missing');
  });
});

describe('move a directory', () => {
  async function seed200(projectId: string): Promise<void> {
    for (let i = 0; i < 200; i++) {
      await writeText(projectId, `/a/${i % 4}/f${String(i).padStart(3, '0')}.md`, `file ${i}`);
    }
  }

  it('moves 200 files, each with a fresh version, and leaves prefix siblings alone', async () => {
    const p = await createProject('P');
    await seed200(p.id);
    const ab = await writeText(p.id, '/ab.md', 'sibling');
    const aDashB = await writeText(p.id, '/a-b/x.md', 'sibling dir');
    const before = await snapshot(p.id);

    await move(p.id, '/a', '/b');

    const after = await snapshot(p.id);
    const byId = new Map(after.files.map((f) => [f.id, f]));
    let moved = 0;
    for (const f of before.files) {
      const g = byId.get(f.id);
      if (f.path.startsWith('/a/')) {
        moved++;
        expect(g?.path).toBe(`/b/${f.path.slice(3)}`);
        expect(g?.version).not.toBe(f.version);
      } else {
        expect(g).toEqual(f);
      }
    }
    expect(moved).toBe(200);
    expect(new Set(after.files.map((f) => f.version)).size).toBe(after.files.length);
    expect((await readText(p.id, '/b/3/f199.md')).text).toBe('file 199');
    expect(await stat(p.id, '/ab.md')).toEqual(ab);
    expect(await stat(p.id, '/a-b/x.md')).toEqual(aDashB);
  });

  it('rolls back completely when a put fails part-way', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(10);
    const p = await createProject('P');
    await seed200(p.id);
    const before = await snapshot(p.id);
    now.mockReturnValue(99);

    let calls = 0;
    _setFaultHookForTests((s, n) => {
      if (s === 'move-put') calls++;
      if (s === 'move-put' && n === 100) throw new Error('injected');
    });
    await expect(move(p.id, '/a', '/b')).rejects.toThrow('injected');
    expect(calls).toBe(101);
    expect(await snapshot(p.id)).toEqual(before);
  });

  it('refuses a colliding target, naming it, and moves nothing', async () => {
    const p = await createProject('P');
    await writeText(p.id, '/a/1.md', '1');
    await writeText(p.id, '/a/2.md', '2');
    await writeText(p.id, '/a/3.md', '3');
    await writeText(p.id, '/b/2.md', 'taken');
    await writeText(p.id, '/b/3.md', 'taken');
    const snap = await snapshot(p.id);
    const e = await expectFsError(move(p.id, '/a', '/b'), 'AlreadyExists');
    expect(detailOf(e).path).toBe('/b/2.md');
    expect(await snapshot(p.id)).toEqual(snap);
  });

  it('refuses moving a directory into itself', async () => {
    const p = await createProject('P');
    await writeText(p.id, '/a/x.md', 'x');
    const e = await expectFsError(move(p.id, '/a', '/a/sub'), 'InvalidPath');
    expect(detailOf(e).reason).toBe('into-self');
    expect((await stat(p.id, '/a/x.md'))?.path).toBe('/a/x.md');
  });

  it('refuses a target below a file', async () => {
    const p = await createProject('P');
    await writeText(p.id, '/a/x.md', 'x');
    await writeText(p.id, '/n.md', 'n');
    const e = await expectFsError(move(p.id, '/a', '/n.md'), 'NotDirectory');
    expect(detailOf(e).path).toBe('/n.md');
  });

  it('treats moving a directory onto itself as a no-op and refuses ifVersion', async () => {
    const p = await createProject('P');
    await writeText(p.id, '/a/x.md', 'x');
    const snap = await snapshot(p.id);
    await move(p.id, '/a', '/a/');
    expect(await snapshot(p.id)).toEqual(snap);
    await expectFsError(move(p.id, '/a', '/b', { ifVersion: 'v' }), 'IsDirectory');
    expect(await snapshot(p.id)).toEqual(snap);
  });

  it('moves a directory up into its parent, even when names repeat', async () => {
    const p = await createProject('P');
    const inner = await writeText(p.id, '/a/b/b/x.md', 'inner');
    const outer = await writeText(p.id, '/a/b/x.md', 'outer');
    await move(p.id, '/a/b', '/a');
    expect((await stat(p.id, '/a/x.md'))?.id).toBe(outer.id);
    expect((await stat(p.id, '/a/b/x.md'))?.id).toBe(inner.id);
  });

  it('merges into an existing directory when no names collide', async () => {
    const p = await createProject('P');
    await writeText(p.id, '/a/x.md', 'x');
    await writeText(p.id, '/b/y.md', 'y');
    await move(p.id, '/a', '/b');
    expect((await readText(p.id, '/b/x.md')).text).toBe('x');
    expect((await readText(p.id, '/b/y.md')).text).toBe('y');
  });
});
