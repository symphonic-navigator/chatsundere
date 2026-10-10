// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db.js';
import { isProjectFsError } from '../../src/projects/errors.js';
import { createProject, move, readText, writeText } from '../../src/projects/fs.js';
import { listRevisions, readRevision, restoreRevision } from '../../src/projects/revisions.js';

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
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

describe('revisions', () => {
  it('lists revisions newest first, with metadata only', async () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1);
    const p = await createProject('P');
    const v1 = await writeText(p.id, '/a.md', 'one');
    now.mockReturnValue(2);
    const v2 = await writeText(p.id, '/a.md', 'two!');
    now.mockReturnValue(3);
    await writeText(p.id, '/a.md', 'three');
    expect(await listRevisions(p.id, '/a.md')).toEqual([
      { version: v2.version, size: 4, createdAt: 3 },
      { version: v1.version, size: 3, createdAt: 2 },
    ]);
  });

  it('orders revisions created in the same millisecond newest first', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(5);
    const p = await createProject('P');
    const versions: string[] = [];
    for (let i = 0; i < 4; i++) versions.push((await writeText(p.id, '/a.md', `t${i}`)).version);
    const listed = (await listRevisions(p.id, '/a.md')).map((r) => r.version);
    expect(listed).toEqual(versions.slice(0, 3).reverse());
  });

  it('reads a revision, and reports a missing one or a missing file as NotFound', async () => {
    const p = await createProject('P');
    const v1 = await writeText(p.id, '/a.md', 'one');
    await writeText(p.id, '/a.md', 'two');
    expect(await readRevision(p.id, '/a.md', v1.version)).toBe('one');
    await expectFsError(readRevision(p.id, '/a.md', 'nope'), 'NotFound');
    await expectFsError(readRevision(p.id, '/b.md', v1.version), 'NotFound');
    await expectFsError(listRevisions(p.id, '/b.md'), 'NotFound');
    expect(await listRevisions(p.id, '/a.md')).toHaveLength(1);
  });

  it('restores a revision as a new version and keeps the replaced text as a revision', async () => {
    const p = await createProject('P');
    const v1 = await writeText(p.id, '/a.md', 'one');
    const v2 = await writeText(p.id, '/a.md', 'two');

    const restored = await restoreRevision(p.id, '/a.md', v1.version);
    expect(restored.id).toBe(v1.id);
    expect(restored.version).not.toBe(v1.version);
    expect(restored.version).not.toBe(v2.version);
    expect((await readText(p.id, '/a.md')).text).toBe('one');
    expect(await readRevision(p.id, '/a.md', v2.version)).toBe('two');
    expect((await listRevisions(p.id, '/a.md')).map((r) => r.version)).toEqual([
      v2.version,
      v1.version,
    ]);
  });

  it('honours ifVersion on restore', async () => {
    const p = await createProject('P');
    const v1 = await writeText(p.id, '/a.md', 'one');
    const v2 = await writeText(p.id, '/a.md', 'two');
    await expectFsError(
      restoreRevision(p.id, '/a.md', v1.version, { ifVersion: v1.version }),
      'VersionConflict',
    );
    expect((await readText(p.id, '/a.md')).text).toBe('two');
    await restoreRevision(p.id, '/a.md', v1.version, { ifVersion: v2.version });
    expect((await readText(p.id, '/a.md')).text).toBe('one');
  });

  it('keeps history across a move of the file and of its parent directory', async () => {
    const p = await createProject('P');
    const v1 = await writeText(p.id, '/notes/a.md', 'one');
    await writeText(p.id, '/notes/a.md', 'two');
    await move(p.id, '/notes/a.md', '/notes/b.md');
    expect(await readRevision(p.id, '/notes/b.md', v1.version)).toBe('one');
    await move(p.id, '/notes', '/archive');
    const revs = await listRevisions(p.id, '/archive/b.md');
    expect(revs.map((r) => r.version)).toEqual([v1.version]);
    await restoreRevision(p.id, '/archive/b.md', v1.version);
    expect((await readText(p.id, '/archive/b.md')).text).toBe('one');
  });
});
