// SPDX-License-Identifier: AGPL-3.0-only
import { useSessionStore } from '@chatsundere/ui-shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sweepOrphanRevisions = vi.fn((): Promise<number> => Promise.resolve(0));

vi.mock('../../src/boot/client-data-identity.js', () => ({
  enforceClientDataIdentity: async () => undefined,
}));
vi.mock('../../src/projects/revisions.js', () => ({
  sweepOrphanRevisions: () => sweepOrphanRevisions(),
}));

import { activateSession } from '../../src/boot/activate-session.js';

describe('activateSession', () => {
  beforeEach(() => {
    sweepOrphanRevisions.mockReset();
  });

  it('sweeps orphan revisions without letting a failure block activation', async () => {
    const failed = Promise.reject(new Error('boom'));
    const handled = vi.spyOn(failed, 'catch');
    sweepOrphanRevisions.mockReturnValue(failed);
    const setSession = vi.spyOn(useSessionStore.getState(), 'setSession');

    await expect(activateSession({} as never)).resolves.toBeUndefined();

    expect(setSession).toHaveBeenCalledOnce();
    expect(sweepOrphanRevisions).toHaveBeenCalledOnce();
    expect(handled).toHaveBeenCalledOnce();
  });
});
