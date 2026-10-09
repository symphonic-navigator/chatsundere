// @vitest-environment node
// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { strToU8, zipSync } from 'fflate';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  type ClientDataDb,
  _resetClientDataDbForTests,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { createProject, list, listProjects, readText, writeText } from '../../src/projects/fs.js';
import { MANIFEST_NAME, exportZip, importZip } from '../../src/projects/zip.js';

let db: ClientDataDb;

beforeEach(async () => {
  await _resetClientDataDbForTests();
  db = await openClientDataDb();
});

function zipOf(entries: Record<string, Uint8Array | string>): Blob {
  const data: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(entries)) data[k] = typeof v === 'string' ? strToU8(v) : v;
  return new Blob([zipSync(data) as BlobPart]);
}

async function expectInvalid(blob: Blob, entry: string) {
  const before = (await listProjects()).length;
  await expect(importZip(blob)).rejects.toMatchObject({ code: 'InvalidPath' });
  await expect(importZip(blob)).rejects.toThrow(entry);
  expect((await listProjects()).length).toBe(before);
  expect(await db.projectFiles.count()).toBe(0);
}

describe('zip', () => {
  it('round trips paths and texts without revisions or trash', async () => {
    const src = await createProject('Source');
    const files: Record<string, string> = {
      '/a.md': 'alpha',
      '/Notizen/Größe café.md': 'Grüße\nzwei',
      '/emoji 🎸.md': '🎸 rock',
      '/deep/x/y/z.md': 'deep',
    };
    for (const [p, t] of Object.entries(files)) await writeText(src.id, p, t);
    await writeText(src.id, '/a.md', 'alpha two');
    files['/a.md'] = 'alpha two';

    const blob = await exportZip(src.id);
    const res = await importZip(blob);
    expect(res.imported).toBe(4);
    expect(res.skipped).toEqual([]);
    expect(res.project.name).toBe('Source');
    const got = await list(res.project.id, '/', { recursive: true });
    expect(got.map((e) => (e.type === 'file' ? e.meta.path : '')).sort()).toEqual(
      Object.keys(files).sort(),
    );
    for (const [p, t] of Object.entries(files)) {
      const read = await readText(res.project.id, p);
      expect(new TextEncoder().encode(read.text)).toEqual(new TextEncoder().encode(t));
    }
    expect(await db.projectRevisions.count()).toBe(1);
    expect(await db.trash.count()).toBe(0);
  });

  it('writes a manifest and uses its name unless one is given', async () => {
    const src = await createProject('Named');
    await writeText(src.id, '/a.md', 'a');
    const blob = await exportZip(src.id);
    const { unzipSync } = await import('fflate');
    const entries = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    expect(Object.keys(entries).sort()).toEqual(['a.md', MANIFEST_NAME]);
    expect(JSON.parse(new TextDecoder().decode(entries[MANIFEST_NAME]))).toEqual({
      format: 'chatsundere-project',
      version: 1,
      name: 'Named',
    });
    expect((await importZip(blob)).project.name).toBe('Named');
    expect((await importZip(blob, { name: 'Mine' })).project.name).toBe('Mine');
  });

  it('falls back to the file name, then to "Imported project"', async () => {
    const file = new File([zipOf({ 'a.md': 'a' })], 'Garden notes.zip');
    expect((await importZip(file)).project.name).toBe('Garden notes');
    expect((await importZip(zipOf({ 'a.md': 'a' }))).project.name).toBe('Imported project');
  });

  it.each([['../x.md'], ['C:\\x.md'], ['a\\b.md']])(
    'rejects the entry %s and creates nothing',
    async (entry) => {
      await expectInvalid(zipOf({ 'ok.md': 'ok', [entry]: 'bad' }), entry);
    },
  );

  it('skips non-Markdown and non-UTF-8 entries', async () => {
    const res = await importZip(
      zipOf({ 'notes.txt': 'plain', 'bin.md': new Uint8Array([0xff, 0xfe, 0xfd]), 'ok.md': 'ok' }),
    );
    expect(res.imported).toBe(1);
    expect(res.skipped.sort()).toEqual(['bin.md', 'notes.txt']);
  });

  it('rejects duplicate paths after normalisation', async () => {
    await expectInvalid(zipOf({ 'a.md': '1', './a.md': '2' }), './a.md');
  });

  it('creates an empty project for a zip without Markdown', async () => {
    const res = await importZip(zipOf({ 'a.txt': 'x' }));
    expect(res.imported).toBe(0);
    expect(res.skipped).toEqual(['a.txt']);
    expect(await listProjects()).toHaveLength(1);
  });
});
