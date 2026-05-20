// SPDX-License-Identifier: AGPL-3.0-only
import type {
  AdminApi,
  AuditEvent,
  AuditListQuery,
  CreateInvitationInput,
  DashboardSummary,
  InvitationCreated,
  InvitationListQuery,
  InvitationSummary,
  Paged,
  UserDetail,
  UserListQuery,
  UserSummary,
} from './admin-api.js';
import { initialAudit, initialInvitations, initialUsers } from './mock-fixtures.js';

/**
 * UUIDv7-shaped ID. Not a real UUIDv7 — the timestamp portion is correct but
 * the randomness is `Math.random`-based. Acceptable for stub IDs that never
 * need cryptographic uniqueness or strict-spec compliance. Replace with a
 * proper helper from `packages/shared-types` once one ships.
 */
function uuidv7Stub(): string {
  const t = Date.now().toString(16).padStart(12, '0');
  const r = Math.random().toString(16).slice(2, 18).padEnd(16, '0');
  return `${t.slice(0, 8)}-${t.slice(8, 12)}-7${r.slice(0, 3)}-8${r.slice(3, 6)}-${r.slice(6, 18)}`;
}

export class MockAdminApi implements AdminApi {
  private users: UserDetail[] = initialUsers();
  private invitations: InvitationSummary[] = initialInvitations();
  private audit: AuditEvent[] = initialAudit();

  private toSummary(u: UserDetail): UserSummary {
    return {
      id: u.id,
      username: u.username,
      role: u.role,
      status: u.status,
      created_at: u.created_at,
      last_login_at: u.last_login_at,
    };
  }

  async listUsers(query: UserListQuery): Promise<Paged<UserSummary>> {
    let filtered = this.users.slice();
    if (query.search) {
      const s = query.search.toLowerCase();
      filtered = filtered.filter((u) => u.username.toLowerCase().includes(s));
    }
    if (query.role && query.role !== 'all') {
      filtered = filtered.filter((u) => u.role === query.role);
    }
    if (query.status && query.status !== 'all') {
      filtered = filtered.filter((u) => u.status === query.status);
    }
    const page = query.page ?? 1;
    const per_page = query.per_page ?? 20;
    const start = (page - 1) * per_page;
    const items = filtered.slice(start, start + per_page).map((u) => this.toSummary(u));
    return { items, total: filtered.length, page, per_page };
  }

  async getUser(id: string): Promise<UserDetail> {
    const u = this.users.find((x) => x.id === id);
    if (!u) throw new Error('user not found');
    const primaryCount = this.users.filter((x) => x.role === 'primary_admin').length;
    return {
      ...structuredClone(u),
      is_last_primary_admin: u.role === 'primary_admin' && primaryCount === 1,
    };
  }

  private categoryFor(event_type: string): AuditEvent['category'] {
    if (event_type.startsWith('user.')) return 'user-lifecycle';
    if (event_type.startsWith('invitation.')) return 'invitation-lifecycle';
    if (event_type.startsWith('auth.')) return 'auth';
    if (event_type.startsWith('recovery.')) return 'recovery';
    return 'admin-action';
  }

  private append(event_type: string, subject_id: string | null, metadata: Record<string, unknown>) {
    this.audit.unshift({
      id: uuidv7Stub(),
      timestamp: new Date().toISOString(),
      event_type,
      category: this.categoryFor(event_type),
      actor_id: 'mock-actor',
      actor_username: 'mock-actor',
      subject_id,
      subject_username: subject_id
        ? (this.users.find((u) => u.id === subject_id)?.username ?? null)
        : null,
      metadata,
    });
  }

  async suspendUser(id: string): Promise<void> {
    const u = this.users.find((x) => x.id === id);
    if (!u) throw new Error('user not found');
    u.status = 'suspended';
    this.append('user.suspended', id, {});
  }

  async unsuspendUser(id: string): Promise<void> {
    const u = this.users.find((x) => x.id === id);
    if (!u) throw new Error('user not found');
    u.status = 'active';
    this.append('user.unsuspended', id, {});
  }

  async deleteUser(id: string): Promise<void> {
    const before = this.users.length;
    this.users = this.users.filter((u) => u.id !== id);
    if (this.users.length === before) throw new Error('user not found');
    this.append('user.deleted', id, {});
  }

  async changeRole(id: string, role: 'user' | 'admin'): Promise<void> {
    const u = this.users.find((x) => x.id === id);
    if (!u) throw new Error('user not found');
    const prev = u.role;
    u.role = role;
    this.append('user.role_changed', id, { from: prev, to: role });
  }

  async transferPrimary(toUserId: string): Promise<void> {
    const current = this.users.find((u) => u.role === 'primary_admin');
    const next = this.users.find((u) => u.id === toUserId);
    if (!current || !next) throw new Error('cannot transfer');
    current.role = 'admin';
    next.role = 'primary_admin';
    this.append('user.role_changed', toUserId, { transferred_from: current.id });
  }

  async listInvitations(query: InvitationListQuery): Promise<Paged<InvitationSummary>> {
    let filtered = this.invitations.slice();
    if (query.status && query.status !== 'all') {
      filtered = filtered.filter((i) => i.status === query.status);
    }
    const page = query.page ?? 1;
    const per_page = query.per_page ?? 20;
    const start = (page - 1) * per_page;
    return {
      items: filtered.slice(start, start + per_page),
      total: filtered.length,
      page,
      per_page,
    };
  }

  async createInvitation(input: CreateInvitationInput): Promise<InvitationCreated> {
    const id = `inv-${uuidv7Stub()}`;
    const tokenBytes = crypto.getRandomValues(new Uint8Array(16));
    const token = Array.from(tokenBytes)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
    const expires_at = new Date(Date.now() + input.expires_in_days * 86_400_000).toISOString();
    const created_at = new Date().toISOString();
    const issuer_label = input.issuer_label ?? 'Local dev instance';
    const qr_payload = JSON.stringify({
      v: 1,
      kind: 'invitation',
      token,
      base_url: 'http://localhost:3100',
      role: input.role,
      issuer_label,
    });
    const url = `http://localhost:5173/link?payload=${btoa(qr_payload)
      .replace(/=+$/, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')}`;
    const inv: InvitationCreated = {
      id,
      role: input.role,
      status: 'pending',
      redeemed_by: null,
      created_at,
      expires_at,
      issuer_label,
      qr_payload,
      url,
    };
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { qr_payload: _qr, url: _url, ...summary } = inv;
    this.invitations.unshift(summary);
    this.append('invitation.created', null, {
      role: input.role,
      expires_in_days: input.expires_in_days,
    });
    return inv;
  }

  async revokeInvitation(id: string): Promise<void> {
    const inv = this.invitations.find((i) => i.id === id);
    if (!inv) throw new Error('invitation not found');
    inv.status = 'revoked';
    this.append('invitation.revoked', null, { invitation_id: id });
  }

  async listAudit(query: AuditListQuery): Promise<Paged<AuditEvent>> {
    let filtered = this.audit.slice();
    if (query.category && query.category !== 'all') {
      filtered = filtered.filter((e) => e.category === query.category);
    }
    if (query.user_id) {
      filtered = filtered.filter(
        (e) => e.actor_id === query.user_id || e.subject_id === query.user_id,
      );
    }
    if (query.from) {
      const from = query.from;
      filtered = filtered.filter((e) => e.timestamp >= from);
    }
    if (query.to) {
      const to = query.to;
      filtered = filtered.filter((e) => e.timestamp <= to);
    }
    const page = query.page ?? 1;
    const per_page = query.per_page ?? 50;
    const start = (page - 1) * per_page;
    return {
      items: filtered.slice(start, start + per_page),
      total: filtered.length,
      page,
      per_page,
    };
  }

  async getDashboardSummary(): Promise<DashboardSummary> {
    return {
      total_users: this.users.length,
      pending_invitations: this.invitations.filter((i) => i.status === 'pending').length,
      suspended_users: this.users.filter((u) => u.status === 'suspended').length,
      recent_activity: this.audit.slice(0, 10),
    };
  }
}
