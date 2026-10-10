// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type ClientDataDb,
  _resetClientDataDbForTests,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';

vi.mock('../../src/projects/revisions.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/projects/revisions.js')>();
  return { ...actual, sweepOrphanRevisions: vi.fn(async () => Promise.reject(new Error('boom'))) };
});

import { purgeCard } from '../../src/trash/trash-repo.js';

let db: ClientDataDb;

beforeEach(async () => {
  await _resetClientDataDbForTests();
  db = await openClientDataDb();
});

describe('purgeCard with a failing revision sweep', () => {
  it('still resolves once the purge has committed and warns', async () => {
    await db.trash.put({
      id: 'chats:c1',
      collection: 'chats',
      key: 'c1',
      row: {},
      deletedAt: 1,
      purgeAt: 1,
      entityKind: 'chat',
      rootGroup: 'chats:c1',
      parentRef: null,
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(purgeCard('chats:c1')).resolves.toBeUndefined();

    expect(await db.trash.count()).toBe(0);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
