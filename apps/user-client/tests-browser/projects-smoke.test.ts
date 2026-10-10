// SPDX-License-Identifier: AGPL-3.0-only
import { beforeAll, describe, expect, it } from 'vitest';
import { closeClientDataDb, openClientDataDb } from '../src/boot/client-data-db.js';
import { createProject, list, move, readText, writeText } from '../src/projects/fs.js';

describe('projects filesystem in a real browser', () => {
  beforeAll(async () => {
    await openClientDataDb();
  });

  it('keeps a moved tree across a close and reopen of IndexedDB', async () => {
    const project = await createProject('Smoke');
    const text = '# Hello\n\nGrüße, café ☕\n';
    await writeText(project.id, '/a/b/c.md', text);
    await writeText(project.id, '/a/d.md', 'second');
    await move(project.id, '/a', '/z');

    closeClientDataDb();
    await openClientDataDb();

    expect((await readText(project.id, '/z/b/c.md')).text).toBe(text);
    const names = (await list(project.id, '/z')).map((e) =>
      e.type === 'dir' ? e.path.split('/').pop() : e.meta.path.split('/').pop(),
    );
    expect(names).toContain('b');
    expect(names).toContain('d.md');
  });
});
