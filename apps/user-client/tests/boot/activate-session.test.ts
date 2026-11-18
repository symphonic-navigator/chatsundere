// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { asMasterKey, createMasterKeySession } from '@chatsundere/crypto';
import { useSessionStore } from '@chatsundere/ui-shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type ClientDataDb,
  type TrashRow,
  _resetClientDataDbForTests,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';

const enforceClientDataIdentity = vi.fn(async (_session: unknown): Promise<void> => undefined);

vi.mock('../../src/boot/client-data-identity.js', () => ({
  enforceClientDataIdentity: (session: unknown) => enforceClientDataIdentity(session),
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

function freshUnlock(username: string) {
  const mk = asMasterKey(crypto.getRandomValues(new Uint8Array(32)));
  const session = createMasterKeySession({
    mk,
    userId: `local-${username}`,
    username,
    mode: 'local',
    online: false,
  });
  return { session, mk };
}

describe('activateSession', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
    db = await openClientDataDb();
    vi.mocked(purgeExpiredTrash).mockClear();
    enforceClientDataIdentity.mockReset();
    enforceClientDataIdentity.mockResolvedValue(undefined);
    useSessionStore.setState({ session: null, mk: null });
  });

  afterEach(() => {
    useSessionStore.setState({ session: null, mk: null });
  });

  it('purges expired trash on unlock and keeps fresh rows', async () => {
    const now = Date.now();
    await db.trash.bulkPut([chatSnapshot('old', now - 1), chatSnapshot('fresh', now + 1_000_000)]);

    await activateSession({} as never, new Uint8Array(32) as never);
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

    await expect(
      activateSession({} as never, new Uint8Array(32) as never),
    ).resolves.toBeUndefined();
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

    await activateSession({ accessToken: 't' } as never, new Uint8Array(32) as never);

    expect(useSessionStore.getState().session).not.toBeNull();
    finish();
  });

  it('sets both the session and the master-key slice', async () => {
    const { session, mk } = freshUnlock('ada');

    await activateSession(session, mk);

    const state = useSessionStore.getState();
    expect(state.session).toBe(session);
    expect(state.mk).toBe(mk);
  });

  it('closes the session it was handed and rethrows when the identity guard throws', async () => {
    const { session, mk } = freshUnlock('ada');
    const close = vi.spyOn(session, 'close');
    const failure = new Error('identity guard failed');
    enforceClientDataIdentity.mockRejectedValue(failure);

    await expect(activateSession(session, mk)).rejects.toBe(failure);

    expect(close).toHaveBeenCalledOnce();
    expect(useSessionStore.getState()).toMatchObject({ session: null, mk: null });
    expect(purgeExpiredTrash).not.toHaveBeenCalled();
  });

  it('leaves the active session and its master key intact when a re-unlock fails its guard', async () => {
    const first = freshUnlock('ada');
    await activateSession(first.session, first.mk);
    const second = freshUnlock('ada');
    enforceClientDataIdentity.mockRejectedValue(new Error('identity guard failed'));

    await expect(activateSession(second.session, second.mk)).rejects.toThrow(
      'identity guard failed',
    );

    const state = useSessionStore.getState();
    expect(state.session).toBe(first.session);
    expect(state.mk).toBe(first.mk);
    expect(state.mk?.some((byte) => byte !== 0)).toBe(true);
    await expect(first.session.deriveDek('probe')).resolves.toBeDefined();
    expect(second.mk.every((byte) => byte === 0)).toBe(true);
  });
});
