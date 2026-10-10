// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  type ClientDataDb,
  _resetClientDataDbForTests,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { createProject, writeText } from '../../src/projects/fs.js';
import { REVISION_CAP } from '../../src/projects/revisions.js';

let db: ClientDataDb;

beforeEach(async () => {
  await _resetClientDataDbForTests();
  db = await openClientDataDb();
});

describe('revision capture', () => {
  it('keeps the newest 20 superseded versions, each with the content it had', async () => {
    expect(REVISION_CAP).toBe(20);
    const p = await createProject('P');
    // One create plus 25 content changes supersedes 25 versions.
    const metas = [await writeText(p.id, '/a.md', 'content 0')];
    for (let i = 1; i <= 25; i++) metas.push(await writeText(p.id, '/a.md', `content ${i}`));
    const fileId = metas[0]?.id ?? '';
    expect(new Set(metas.map((m) => m.id)).size).toBe(1);

    const revs = await db.projectRevisions.where('fileId').equals(fileId).toArray();
    expect(revs).toHaveLength(20);

    const superseded = metas.slice(0, 25);
    const kept = new Map(revs.map((r) => [r.version, r]));
    for (const [i, m] of superseded.entries()) {
      const r = kept.get(m.version);
      if (i < 5) {
        expect(r).toBeUndefined();
      } else {
        expect(r?.text).toBe(`content ${i}`);
        expect(r?.size).toBe(new TextEncoder().encode(`content ${i}`).byteLength);
      }
    }
    expect(kept.has(metas[25]?.version ?? '')).toBe(false);
  });
});
