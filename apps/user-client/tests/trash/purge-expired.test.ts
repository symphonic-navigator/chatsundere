// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type ClientDataDb,
  type TrashRow,
  _resetClientDataDbForTests,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';

// The real sweep by default; a test can make it fail once.
vi.mock('../../src/projects/revisions.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/projects/revisions.js')>();
  return { ...actual, sweepOrphanRevisions: vi.fn(actual.sweepOrphanRevisions) };
});

import { sweepOrphanRevisions } from '../../src/projects/revisions.js';
import { purgeExpiredTrash } from '../../src/trash/purge.js';

let db: ClientDataDb;

function chatSnapshot(key: string, purgeAt: number): TrashRow {
  return {
    id: `chats:${key}`,
    collection: 'chats',
    key,
    row: {},
    deletedAt: purgeAt - 1,
    purgeAt,
    entityKind: 'chat',
    rootGroup: `chats:${key}`,
    parentRef: null,
  };
}

beforeEach(async () => {
  await _resetClientDataDbForTests();
  db = await openClientDataDb();
  vi.mocked(sweepOrphanRevisions).mockClear();
});

describe('purgeExpiredTrash', () => {
  it('deletes rows past their grace and keeps fresh ones', async () => {
    const now = Date.now();
    await db.trash.bulkPut([chatSnapshot('old', now - 1), chatSnapshot('fresh', now + 1_000_000)]);

    await purgeExpiredTrash();

    expect(await db.trash.get('chats:old')).toBeUndefined();
    expect(await db.trash.get('chats:fresh')).toBeDefined();
    expect(sweepOrphanRevisions).toHaveBeenCalledOnce();
  });

  it('resolves and warns when the revision sweep fails after the purge', async () => {
    vi.mocked(sweepOrphanRevisions).mockRejectedValueOnce(new Error('sweep broke'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await db.trash.put(chatSnapshot('old', Date.now() - 1));

    await expect(purgeExpiredTrash()).resolves.toBeUndefined();

    expect(await db.trash.count()).toBe(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
