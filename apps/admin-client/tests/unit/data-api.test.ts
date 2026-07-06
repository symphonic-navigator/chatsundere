// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiFetchMock = vi.fn();
vi.mock('../../src/lib/fetch.js', () => ({
  apiFetch: (opts: unknown) => apiFetchMock(opts),
  HttpError: class HttpError extends Error {},
}));
vi.mock('../../src/env.js', () => ({
  env: { VITE_AUTH_URL: 'http://auth.test' },
}));

import {
  createInvitation,
  getDashboardSummary,
  getUser,
  listAudit,
  listUsers,
} from '../../src/data/api.js';

interface FetchOpts {
  baseUrl: string;
  path: string;
  json?: unknown;
  method?: string;
}

function callPath(n: number): string {
  const call = apiFetchMock.mock.calls[n]?.[0] as FetchOpts | undefined;
  return call?.path ?? '';
}

beforeEach(() => {
  apiFetchMock.mockReset();
});

describe('listUsers', () => {
  it('maps page/per_page to limit/offset and drops all-filters', async () => {
    apiFetchMock.mockResolvedValue({ users: [], total: 0 });
    await listUsers({ search: 'ali', role: 'all', status: 'suspended', page: 3, per_page: 20 });
    const path = callPath(0);
    expect(path).toContain('/api/v1/admin/users?');
    expect(path).toContain('q=ali');
    expect(path).not.toContain('role=');
    expect(path).toContain('status=suspended');
    expect(path).toContain('limit=20');
    expect(path).toContain('offset=40');
  });

  it('wraps the response into Paged with derived status', async () => {
    apiFetchMock.mockResolvedValue({
      users: [
        {
          id: 'u1',
          username: 'alice',
          role: 'user',
          suspended_at: null,
          created_at: '2026-01-01T00:00:00Z',
          last_login_at: null,
        },
      ],
      total: 41,
    });
    const page = await listUsers({ page: 2, per_page: 20 });
    expect(page.total).toBe(41);
    expect(page.page).toBe(2);
    expect(page.per_page).toBe(20);
    expect(page.items[0]?.status).toBe('active');
  });
});

describe('getUser', () => {
  it('derives status and is_last_primary_admin', async () => {
    apiFetchMock.mockResolvedValue({
      id: 'u2',
      username: 'root',
      role: 'primary_admin',
      suspended_at: null,
      created_at: '2026-01-01T00:00:00Z',
      last_login_at: null,
      auth_methods: [],
    });
    const detail = await getUser('u2');
    expect(detail.status).toBe('active');
    expect(detail.is_last_primary_admin).toBe(true);
  });
});

describe('listAudit', () => {
  it('maps from/to to since/until (UTC day bounds) and derives category', async () => {
    apiFetchMock.mockResolvedValue({
      entries: [
        {
          id: 'a1',
          user_id: null,
          actor_user_id: null,
          user_username: null,
          actor_username: null,
          event_type: 'auth.login.failed',
          metadata: {},
          created_at: '2026-07-01T12:00:00Z',
        },
      ],
      total: 1,
    });
    const page = await listAudit({ from: '2026-07-01', to: '2026-07-02', page: 1 });
    const path = callPath(0);
    expect(path).toContain(encodeURIComponent('2026-07-01T00:00:00.000Z'));
    expect(path).toContain(encodeURIComponent('2026-07-02T23:59:59.999Z'));
    expect(page.items[0]?.category).toBe('auth');
  });
});

describe('createInvitation', () => {
  it('converts days to seconds and passes optional fields through', async () => {
    apiFetchMock.mockResolvedValue({
      invitation_id: 'i1',
      code: 'ABCDEFGHIJ',
      qr_url: 'http://x/join#ABCDEFGHIJ',
      expires_at: '2026-07-11T00:00:00Z',
      state: 'active',
    });
    await createInvitation({
      role: 'user',
      expires_in_days: 7,
      suggested_username: 'newbie',
      note: 'from Discord',
    });
    const call = apiFetchMock.mock.calls[0]?.[0] as FetchOpts;
    expect(call.json).toEqual({
      role: 'user',
      expires_in_seconds: 604_800,
      suggested_username: 'newbie',
      note: 'from Discord',
    });
  });
});

describe('getDashboardSummary', () => {
  it('composes totals from the list endpoints', async () => {
    apiFetchMock.mockImplementation((opts: FetchOpts) => {
      const p = opts.path;
      if (p.includes('/admin/users') && p.includes('status=suspended')) {
        return Promise.resolve({ users: [], total: 2 });
      }
      if (p.includes('/admin/users')) return Promise.resolve({ users: [], total: 12 });
      if (p.includes('/admin/invitations')) {
        return Promise.resolve({
          invitations: [
            { expires_at: '2026-07-06T00:00:00Z', status: 'pending' },
            { expires_at: '2026-07-05T00:00:00Z', status: 'pending' },
          ],
          total: 3,
        });
      }
      if (p.includes('since=')) return Promise.resolve({ entries: [], total: 247 });
      return Promise.resolve({ entries: [], total: 999 });
    });
    const summary = await getDashboardSummary();
    expect(summary.total_users).toBe(12);
    expect(summary.suspended_users).toBe(2);
    expect(summary.pending_invitations).toBe(3);
    expect(summary.soonest_pending_expiry).toBe('2026-07-05T00:00:00Z');
    expect(summary.events_24h).toBe(247);
  });
});
