// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ProjectFileRow, TrashRow } from '../../src/boot/client-data-db.js';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db.js';

function fileRow(over: Partial<ProjectFileRow>): ProjectFileRow {
  return {
    id: 'f1',
    projectId: 'p1',
    path: '/a.md',
    kind: 'markdown',
    size: 0,
    version: 'v1',
    contentHash: 'h',
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

describe('project schema (v37)', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('opens at v37 with the project tables', async () => {
    const db = await openClientDataDb();
    expect(db.verno).toBe(37);
    const names = db.tables.map((t) => t.name);
    for (const n of ['projects', 'projectFiles', 'projectContents', 'projectRevisions']) {
      expect(names).toContain(n);
    }
  });

  it('enforces a unique path per project', async () => {
    const db = await openClientDataDb();
    await db.projectFiles.add(fileRow({ id: 'f1' }));
    await expect(db.projectFiles.add(fileRow({ id: 'f2' }))).rejects.toMatchObject({
      name: 'ConstraintError',
    });
    await expect(db.projectFiles.add(fileRow({ id: 'f3', projectId: 'p2' }))).resolves.toBe('f3');
  });

  it('keeps existing trash rows valid', async () => {
    const db = await openClientDataDb();
    const row: TrashRow = {
      id: 'chats:c1',
      collection: 'chats',
      key: 'c1',
      row: { id: 'c1' },
      deletedAt: 1,
      purgeAt: 2,
      entityKind: 'chat',
      rootGroup: 'chats:c1',
      parentRef: null,
    };
    await db.trash.put(row);
    expect(await db.trash.get('chats:c1')).toEqual(row);
  });
});
