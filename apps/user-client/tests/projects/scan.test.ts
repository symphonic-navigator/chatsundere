// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type ClientDataDb,
  _resetClientDataDbForTests,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { createProject, writeText } from '../../src/projects/fs.js';
import { scan } from '../../src/projects/scan.js';

let db: ClientDataDb;

beforeEach(async () => {
  await _resetClientDataDbForTests();
  db = await openClientDataDb();
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function collect(it: AsyncIterable<{ meta: { path: string }; text: string }>) {
  const out: { path: string; text: string }[] = [];
  for await (const { meta, text } of it) out.push({ path: meta.path, text });
  return out;
}

describe('scan', () => {
  it('iterates 1,000 files of about 8 KB in batches of 100 within 3 seconds', async () => {
    const p = await createProject('Big');
    const text = 'x'.repeat(8 * 1024);
    const now = Date.now();
    const rows = Array.from({ length: 1000 }, (_, i) => ({
      id: `f${i}`,
      projectId: p.id,
      path: `/n/${String(i).padStart(4, '0')}.md`,
      kind: 'markdown' as const,
      size: text.length,
      version: `v${i}`,
      contentHash: 'h',
      createdAt: now,
      updatedAt: now,
    }));
    await db.projectFiles.bulkAdd(rows);
    await db.projectContents.bulkAdd(rows.map((r) => ({ fileId: r.id, text })));

    const spy = vi.spyOn(db.projectContents, 'bulkGet');
    const started = performance.now();
    const seen = await collect(scan(p.id));
    const elapsed = performance.now() - started;
    console.log(`scan of 1,000 files took ${elapsed.toFixed(0)} ms`);
    expect(seen).toHaveLength(1000);
    expect(seen[0]?.text).toBe(text);
    expect(elapsed).toBeLessThan(3000);
    expect(spy).toHaveBeenCalledTimes(10);
  });

  it('calls bulkGet ceil(n / 100) times for an uneven count', async () => {
    const p = await createProject('Odd');
    for (let i = 0; i < 101; i++) await writeText(p.id, `/f${i}.md`, `t${i}`);
    const spy = vi.spyOn(db.projectContents, 'bulkGet');
    expect(await collect(scan(p.id))).toHaveLength(101);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('filters by prefix without matching sibling names', async () => {
    const p = await createProject('P');
    await writeText(p.id, '/a/x.md', 'x');
    await writeText(p.id, '/a/b/y.md', 'y');
    await writeText(p.id, '/ab.md', 'z');
    expect((await collect(scan(p.id, { prefix: '/a' }))).map((e) => e.path)).toEqual([
      '/a/b/y.md',
      '/a/x.md',
    ]);
  });

  it('skips hidden files unless the prefix is hidden', async () => {
    const p = await createProject('P');
    await writeText(p.id, '/a.md', 'a');
    await writeText(p.id, '/.h/b.md', 'b');
    expect((await collect(scan(p.id))).map((e) => e.path)).toEqual(['/a.md']);
    expect((await collect(scan(p.id, { prefix: '/.h' }))).map((e) => e.path)).toEqual(['/.h/b.md']);
  });

  it('rejects for a missing project', async () => {
    await expect(collect(scan('nope'))).rejects.toMatchObject({ code: 'NotFound' });
  });
});
