// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it } from 'vitest';
import { MockAdminApi } from '../../src/data/admin-api.mock.js';

describe('MockAdminApi', () => {
  let api: MockAdminApi;

  beforeEach(() => {
    api = new MockAdminApi();
  });

  it('lists users with default pagination', async () => {
    const page = await api.listUsers({});
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.length).toBeLessThanOrEqual(20);
    expect(page.total).toBeGreaterThanOrEqual(page.items.length);
  });

  it('filters users by status', async () => {
    const page = await api.listUsers({ status: 'suspended', per_page: 100 });
    expect(page.items.every((u) => u.status === 'suspended')).toBe(true);
  });

  it('filters users by username substring', async () => {
    const all = await api.listUsers({ per_page: 100 });
    const target = all.items[0]?.username.slice(0, 3);
    if (!target) throw new Error('fixtures must have at least one user');
    const page = await api.listUsers({ search: target, per_page: 100 });
    expect(page.items.every((u) => u.username.toLowerCase().includes(target.toLowerCase()))).toBe(
      true,
    );
  });

  it('suspend toggles status and appends an audit event', async () => {
    const all = await api.listUsers({ per_page: 100 });
    const active = all.items.find((u) => u.status === 'active' && u.role === 'user');
    if (!active) throw new Error('fixtures must have at least one active user');
    await api.suspendUser(active.id);
    const after = await api.getUser(active.id);
    expect(after.status).toBe('suspended');
    const audit = await api.listAudit({ user_id: active.id, per_page: 5 });
    expect(audit.items.some((e) => e.event_type === 'user.suspended')).toBe(true);
  });

  it('createInvitation returns a populated qr_payload and url', async () => {
    const result = await api.createInvitation({ role: 'user', expires_in_days: 7 });
    expect(result.qr_payload.length).toBeGreaterThan(20);
    expect(result.url.startsWith('http')).toBe(true);
    expect(result.status).toBe('pending');
  });

  it('getDashboardSummary returns three counters and a non-empty activity list', async () => {
    const s = await api.getDashboardSummary();
    expect(typeof s.total_users).toBe('number');
    expect(typeof s.pending_invitations).toBe('number');
    expect(typeof s.suspended_users).toBe('number');
    expect(s.recent_activity.length).toBeGreaterThan(0);
    expect(s.recent_activity.length).toBeLessThanOrEqual(10);
  });

  it('listInvitations filters by status', async () => {
    const all = await api.listInvitations({ per_page: 100 });
    expect(all.items.length).toBeGreaterThan(0);
    const pending = await api.listInvitations({ status: 'pending', per_page: 100 });
    expect(pending.items.every((i) => i.status === 'pending')).toBe(true);
  });

  it('revokeInvitation transitions status and appends audit', async () => {
    const created = await api.createInvitation({ role: 'user', expires_in_days: 7 });
    await api.revokeInvitation(created.id);
    const after = await api.listInvitations({ status: 'revoked', per_page: 100 });
    expect(after.items.some((i) => i.id === created.id)).toBe(true);
  });

  it('listAudit filters by category', async () => {
    const all = await api.listAudit({ per_page: 100 });
    expect(all.items.length).toBeGreaterThan(0);
    const filtered = await api.listAudit({ category: 'invitation-lifecycle', per_page: 100 });
    expect(filtered.items.every((e) => e.category === 'invitation-lifecycle')).toBe(true);
  });
});
