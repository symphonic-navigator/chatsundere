// SPDX-License-Identifier: AGPL-3.0-only
import { asMasterKey, createMasterKeySession } from '@chatsundere/crypto';
import { useSessionStore } from '@chatsundere/ui-shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sweepOrphanRevisions = vi.fn((): Promise<number> => Promise.resolve(0));
const enforceClientDataIdentity = vi.fn(async (_session: unknown): Promise<void> => undefined);

vi.mock('../../src/boot/client-data-identity.js', () => ({
  enforceClientDataIdentity: (session: unknown) => enforceClientDataIdentity(session),
}));
vi.mock('../../src/projects/revisions.js', () => ({
  sweepOrphanRevisions: () => sweepOrphanRevisions(),
}));

import { activateSession } from '../../src/boot/activate-session.js';

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
  beforeEach(() => {
    sweepOrphanRevisions.mockReset();
    sweepOrphanRevisions.mockResolvedValue(0);
    enforceClientDataIdentity.mockReset();
    enforceClientDataIdentity.mockResolvedValue(undefined);
    useSessionStore.setState({ session: null, mk: null });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    useSessionStore.setState({ session: null, mk: null });
  });

  it('sweeps orphan revisions without letting a failure block activation', async () => {
    const failed = Promise.reject(new Error('boom'));
    const handled = vi.spyOn(failed, 'catch');
    sweepOrphanRevisions.mockReturnValue(failed);
    const setSession = vi.spyOn(useSessionStore.getState(), 'setSession');

    await expect(
      activateSession({} as never, new Uint8Array(32) as never),
    ).resolves.toBeUndefined();

    expect(setSession).toHaveBeenCalledOnce();
    expect(sweepOrphanRevisions).toHaveBeenCalledOnce();
    expect(handled).toHaveBeenCalledOnce();
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
    expect(sweepOrphanRevisions).not.toHaveBeenCalled();
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
