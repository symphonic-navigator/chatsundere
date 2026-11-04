// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { recentMock } = vi.hoisted(() => ({ recentMock: vi.fn() }));

vi.mock('../../../src/mcp/oauth/sign-in.js', async (orig) => ({
  ...(await orig<typeof import('../../../src/mcp/oauth/sign-in.js')>()),
  recentPendingSignIn: (...a: unknown[]) => recentMock(...a),
}));

import { postUnlockTarget, waitingScreenPath } from '../../../src/mcp/oauth/sign-in-session.js';

describe('postUnlockTarget', () => {
  beforeEach(() => {
    recentMock.mockReset();
  });

  it('returns to the waiting screen of a sign-in started within 2 minutes', async () => {
    recentMock.mockResolvedValue({ state: 'abc' });
    expect(await postUnlockTarget('/app')).toBe(waitingScreenPath('abc'));
    expect(waitingScreenPath('abc')).toBe('/app/integrations/sign-in/abc');
  });

  it('keeps the usual target when there is none, so older ones wait in the list', async () => {
    recentMock.mockResolvedValue(null);
    expect(await postUnlockTarget('/app/chat/1')).toBe('/app/chat/1');
  });

  it('keeps the usual target when looking fails', async () => {
    recentMock.mockImplementation(async () => {
      throw new Error('storage');
    });
    expect(await postUnlockTarget('/app')).toBe('/app');
  });
});
