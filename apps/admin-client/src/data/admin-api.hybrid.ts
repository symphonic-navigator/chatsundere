// SPDX-License-Identifier: AGPL-3.0-only
import { HttpError } from '../lib/fetch.js';
import type { Role } from '../lib/self-target.js';
import type { AdminApi, Paged, UserDetail, UserListQuery, UserSummary } from './admin-api.js';
import type { LiveAdminApi } from './admin-api.live.js';
import type { MockAdminApi } from './admin-api.mock.js';

/**
 * Snapshot of the current session used by the hybrid composer to inject a
 * self-row into mock results. Kept narrow on purpose: the composer should
 * never reach into the broader session shape (e.g. `mk`, `accessToken`).
 */
export interface SelfSnapshot {
  userId: string | null;
  username: string | null;
  role: Role | null;
}

/**
 * Hybrid composer: tries the live impl first; on `HttpError(501,
 * 'not_implemented')`, falls through to the mock. As live endpoints land in
 * the auth-service squash, individual methods on LiveAdminApi start
 * returning real data and the mock is bypassed for those endpoints.
 *
 * When the user-listing endpoints fall back to the mock, the composer
 * additionally synthesises a "self-row" so the current operator appears in
 * the list. Without this, manual QA cannot exercise self-target gating: the
 * mock fixtures never contain the live session's `userId`, so the predicate
 * would never see itself as a match. The injection only runs in the mock
 * fall-through path; once `LiveAdminApi.listUsers` returns real data the
 * live response is authoritative and untouched.
 */
export class HybridAdminApi implements AdminApi {
  constructor(
    private readonly live: LiveAdminApi,
    private readonly mock: MockAdminApi,
    private readonly getSession: () => SelfSnapshot,
  ) {}

  private async tryLive<T>(liveFn: () => Promise<T>, mockFn: () => Promise<T>): Promise<T> {
    try {
      return await liveFn();
    } catch (e) {
      if (e instanceof HttpError && e.status === 501 && e.code === 'not_implemented') {
        return mockFn();
      }
      throw e;
    }
  }

  listUsers: AdminApi['listUsers'] = (q) =>
    this.tryLive(
      () => this.live.listUsers(q),
      async () => this.injectSelfIntoList(await this.mock.listUsers(q), q),
    );

  getUser: AdminApi['getUser'] = (id) =>
    this.tryLive(
      () => this.live.getUser(id),
      () => this.getMockOrSelfDetail(id),
    );

  suspendUser: AdminApi['suspendUser'] = (id) =>
    this.tryLive(
      () => this.live.suspendUser(id),
      () => this.mock.suspendUser(id),
    );

  unsuspendUser: AdminApi['unsuspendUser'] = (id) =>
    this.tryLive(
      () => this.live.unsuspendUser(id),
      () => this.mock.unsuspendUser(id),
    );

  deleteUser: AdminApi['deleteUser'] = (id) =>
    this.tryLive(
      () => this.live.deleteUser(id),
      () => this.mock.deleteUser(id),
    );

  changeRole: AdminApi['changeRole'] = (id, role) =>
    this.tryLive(
      () => this.live.changeRole(id, role),
      () => this.mock.changeRole(id, role),
    );

  transferPrimary: AdminApi['transferPrimary'] = (id) =>
    this.tryLive(
      () => this.live.transferPrimary(id),
      () => this.mock.transferPrimary(id),
    );

  listInvitations: AdminApi['listInvitations'] = (q) =>
    this.tryLive(
      () => this.live.listInvitations(q),
      () => this.mock.listInvitations(q),
    );

  createInvitation: AdminApi['createInvitation'] = (input) =>
    this.tryLive(
      () => this.live.createInvitation(input),
      () => this.mock.createInvitation(input),
    );

  revokeInvitation: AdminApi['revokeInvitation'] = (id) =>
    this.tryLive(
      () => this.live.revokeInvitation(id),
      () => this.mock.revokeInvitation(id),
    );

  listAudit: AdminApi['listAudit'] = (q) =>
    this.tryLive(
      () => this.live.listAudit(q),
      () => this.mock.listAudit(q),
    );

  getDashboardSummary: AdminApi['getDashboardSummary'] = () =>
    this.tryLive(
      () => this.live.getDashboardSummary(),
      () => this.mock.getDashboardSummary(),
    );

  // ─── Self-injection helpers ──────────────────────────────────────────────

  private buildSelfRow(session: SelfSnapshot): UserSummary | null {
    if (!session.userId || !session.username) return null;
    const now = new Date().toISOString();
    return {
      id: session.userId,
      username: session.username,
      role: session.role ?? 'user',
      status: 'active',
      created_at: now,
      last_login_at: now,
    };
  }

  /** Mirror of the mock filter logic so the self-row respects active filters. */
  private selfMatchesQuery(self: UserSummary, query: UserListQuery): boolean {
    if (query.search && !self.username.toLowerCase().includes(query.search.toLowerCase())) {
      return false;
    }
    if (query.role && query.role !== 'all' && query.role !== self.role) return false;
    if (query.status && query.status !== 'all' && query.status !== self.status) return false;
    return true;
  }

  private injectSelfIntoList(result: Paged<UserSummary>, query: UserListQuery): Paged<UserSummary> {
    const self = this.buildSelfRow(this.getSession());
    if (!self) return result;
    if (result.items.some((u) => u.id === self.id)) return result;
    if (!this.selfMatchesQuery(self, query)) return result;
    // Only prepend on page 1; injecting onto later pages would misrepresent
    // pagination. `total` still reflects the inflated count so paging arithmetic
    // stays consistent.
    const page = query.page ?? 1;
    const items = page === 1 ? [self, ...result.items] : result.items;
    return { ...result, items, total: result.total + 1 };
  }

  private async getMockOrSelfDetail(id: string): Promise<UserDetail> {
    const session = this.getSession();
    const isSelfDetail = session.userId === id && !!session.username;
    if (isSelfDetail) {
      return this.synthSelfDetail(session);
    }
    // Mock user: take the detail as the mock computed it, but rewrite
    // `is_last_primary_admin` from the *combined* list (mock + injected self).
    // Otherwise the mock thinks its only primary_admin fixture is the last
    // one, even when the live session is also `primary_admin`.
    const detail = await this.mock.getUser(id);
    if (detail.role !== 'primary_admin') return detail;
    return { ...detail, is_last_primary_admin: await this.computeIsLastPrimary(detail.id) };
  }

  private async synthSelfDetail(session: SelfSnapshot): Promise<UserDetail> {
    const role = session.role ?? 'user';
    const now = new Date().toISOString();
    const userId = session.userId ?? '';
    const username = session.username ?? '';
    const isLast = role === 'primary_admin' ? await this.computeIsLastPrimary(userId) : false;
    return {
      id: userId,
      username,
      role,
      status: 'active',
      created_at: now,
      last_login_at: now,
      auth_methods: [
        { id: 'self-passphrase', label: 'Passphrase', type: 'passphrase', last_used_at: now },
      ],
      is_last_primary_admin: isLast,
    };
  }

  /**
   * True when `targetUserId` is the only `primary_admin` across the combined
   * mock fixtures + injected self-row. Counts every `primary_admin` other than
   * `targetUserId`; if none, the target is the last one.
   */
  private async computeIsLastPrimary(targetUserId: string): Promise<boolean> {
    const session = this.getSession();
    const mockList = await this.mock.listUsers({ page: 1, per_page: 1000 });
    const otherMockPrimaries = mockList.items.filter(
      (u) => u.role === 'primary_admin' && u.id !== targetUserId,
    ).length;
    const selfIsOtherPrimary =
      session.role === 'primary_admin' && session.userId !== null && session.userId !== targetUserId
        ? 1
        : 0;
    return otherMockPrimaries + selfIsOtherPrimary === 0;
  }
}
