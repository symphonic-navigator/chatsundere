// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type ClientDataDb,
  _resetClientDataDbForTests,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import {
  _setAsyncFaultHookForTests,
  createProject,
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
  _setAsyncFaultHookForTests(null);
});

/** A non-Dexie await: a timer lets IndexedDB auto-commit the transaction. */
const timerAwait = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

/** The failure Dexie raises once the transaction has committed under it. */
const AUTO_COMMITTED = {
  name: expect.stringMatching(/^(TransactionInactiveError|PrematureCommitError)$/),
};

// Guards spec §8.1: inside a Dexie transaction only Dexie operations may be
// awaited. If that rule is broken the transaction auto-commits early and the
// operation must fail without writing anything — never half-write.
describe('transaction auto-commit guard', () => {
  it('writeText rejects and writes nothing when a non-Dexie await sits inside its transaction', async () => {
    const p = await createProject('P');
    await writeText(p.id, '/a.md', 'before');
    const filesBefore = await db.projectFiles.toArray();
    const revisionsBefore = await db.projectRevisions.count();

    _setAsyncFaultHookForTests(timerAwait);
    await expect(writeText(p.id, '/a.md', 'after')).rejects.toMatchObject(AUTO_COMMITTED);
    await expect(writeText(p.id, '/b.md', 'new')).rejects.toMatchObject(AUTO_COMMITTED);
    _setAsyncFaultHookForTests(null);

    expect((await readText(p.id, '/a.md')).text).toBe('before');
    expect(await stat(p.id, '/b.md')).toBeNull();
    expect(await db.projectFiles.toArray()).toEqual(filesBefore);
    expect(await db.projectRevisions.count()).toBe(revisionsBefore);
  });

  it('move rejects and moves nothing when a non-Dexie await sits inside its transaction', async () => {
    const p = await createProject('P');
    await writeText(p.id, '/notes/a.md', 'a');
    await writeText(p.id, '/notes/b.md', 'b');
    const filesBefore = await db.projectFiles.toArray();

    _setAsyncFaultHookForTests(timerAwait);
    await expect(move(p.id, '/notes', '/archive')).rejects.toMatchObject(AUTO_COMMITTED);
    _setAsyncFaultHookForTests(null);

    expect(await db.projectFiles.toArray()).toEqual(filesBefore);
    expect(await stat(p.id, '/archive/a.md')).toBeNull();
  });

  it('passes with no hook installed (control)', async () => {
    const p = await createProject('P');
    await writeText(p.id, '/notes/a.md', 'a');
    await writeText(p.id, '/notes/a.md', 'a2');
    await move(p.id, '/notes', '/archive');
    expect((await readText(p.id, '/archive/a.md')).text).toBe('a2');
  });
});
