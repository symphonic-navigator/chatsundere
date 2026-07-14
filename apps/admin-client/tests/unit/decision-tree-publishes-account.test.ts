// SPDX-License-Identifier: AGPL-3.0-only
import { useAccountLinkStore } from '@chatsundere/ui-shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getLocalAccountMock = vi.fn();
const getLinkedAccountMock = vi.fn();
const closeMock = vi.fn();

vi.mock('@chatsundere/crypto', () => ({
  openLocalDb: () => Promise.resolve({ close: closeMock }),
  getLocalAccount: (db: unknown) => getLocalAccountMock(db),
  getLinkedAccount: (db: unknown) => getLinkedAccountMock(db),
}));

import { runDecisionTreePreLogin } from '../../src/routes/login/decision-tree.js';

const LINKED_ROW = {
  server_user_id: 'u-1',
  base_url: 'https://auth.example.com',
  issuer_label: 'Example',
  role: 'primary_admin' as const,
};

describe('runDecisionTreePreLogin account publication', () => {
  beforeEach(() => {
    getLocalAccountMock.mockReset();
    getLinkedAccountMock.mockReset();
    closeMock.mockReset();
    useAccountLinkStore.setState({
      linkStatus: 'unknown',
      baseUrl: null,
      issuerLabel: null,
      role: null,
    });
  });

  it('publishes the linked row so the data layer can reach the server', async () => {
    getLocalAccountMock.mockResolvedValue({ id: 'local' });
    getLinkedAccountMock.mockResolvedValue(LINKED_ROW);
    // jsdom reports navigator.onLine as true by default, which is the
    // 'ready' precondition — no stubbing needed.

    const result = await runDecisionTreePreLogin();

    expect(result.branch).toBe('ready');
    expect(useAccountLinkStore.getState().baseUrl).toBe('https://auth.example.com');
    expect(useAccountLinkStore.getState().role).toBe('primary_admin');
  });

  it('marks the store local-only when the account is not linked', async () => {
    getLocalAccountMock.mockResolvedValue({ id: 'local' });
    getLinkedAccountMock.mockResolvedValue(null);

    const result = await runDecisionTreePreLogin();

    expect(result.branch).toBe('no_link');
    expect(useAccountLinkStore.getState().linkStatus).toBe('local-only');
    expect(useAccountLinkStore.getState().baseUrl).toBeNull();
  });

  it('closes the database even when a branch returns early', async () => {
    getLocalAccountMock.mockResolvedValue(null);
    await runDecisionTreePreLogin();
    expect(closeMock).toHaveBeenCalledTimes(1);
  });

  describe('when offline', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    // Publication must happen before the online check, so an offline operator
    // with a valid linked row still gets a usable base URL for the retry
    // path. The baseUrl assertion is what pins that ordering: if setLinked
    // ever moved inside an `if (navigator.onLine)` guard, this would fail
    // while every other test in this file kept passing.
    it('still publishes the linked row so a retry can reach the server', async () => {
      vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
      getLocalAccountMock.mockResolvedValue({ id: 'local' });
      getLinkedAccountMock.mockResolvedValue(LINKED_ROW);

      const result = await runDecisionTreePreLogin();

      expect(result.branch).toBe('offline');
      expect(useAccountLinkStore.getState().baseUrl).toBe('https://auth.example.com');
    });
  });
});
