// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { useSessionStore } from '@chatsundere/ui-shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type ClientDataDb,
  type TrashRow,
  _resetClientDataDbForTests,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';

vi.mock('../../src/boot/client-data-identity.js', () => ({
  enforceClientDataIdentity: async () => undefined,
}));
// The real purge by default; a test can make it fail once.
vi.mock('../../src/trash/purge.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/trash/purge.js')>();
  return { ...actual, purgeExpiredTrash: vi.fn(actual.purgeExpiredTrash) };
});

import { activateSession } from '../../src/boot/activate-session.js';
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

describe('activateSession', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
    db = await openClientDataDb();
    vi.mocked(purgeExpiredTrash).mockClear();
  });

  afterEach(() => {
    useSessionStore.setState({ session: null, mk: null });
  });

  it('purges expired trash on unlock and keeps fresh rows', async () => {
    const now = Date.now();
    await db.trash.bulkPut([chatSnapshot('old', now - 1), chatSnapshot('fresh', now + 1_000_000)]);

    await activateSession({} as never);
    // The purge runs in the background; wait for the one this unlock started.
    await vi.mocked(purgeExpiredTrash).mock.results[0]?.value;

    expect(purgeExpiredTrash).toHaveBeenCalledOnce();
    expect(await db.trash.get('chats:old')).toBeUndefined();
    expect(await db.trash.get('chats:fresh')).toBeDefined();
  });

  it('does not let a failing purge block or fail the unlock', async () => {
    const failed = Promise.reject(new Error('boom'));
    const handled = vi.spyOn(failed, 'catch');
    vi.mocked(purgeExpiredTrash).mockReturnValueOnce(failed);
    const setSession = vi.spyOn(useSessionStore.getState(), 'setSession');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(activateSession({} as never)).resolves.toBeUndefined();
    await failed.catch(() => {});

    expect(setSession).toHaveBeenCalledOnce();
    expect(purgeExpiredTrash).toHaveBeenCalledOnce();
    expect(handled).toHaveBeenCalled();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
    setSession.mockRestore();
  });

  it('does not wait for the purge before activating the session', async () => {
    let finish: () => void = () => {};
    vi.mocked(purgeExpiredTrash).mockReturnValueOnce(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );

    await activateSession({ accessToken: 't' } as never);

    expect(useSessionStore.getState().session).not.toBeNull();
    finish();
  });
});
