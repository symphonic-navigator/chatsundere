// SPDX-License-Identifier: AGPL-3.0-only
import { HttpError } from '../lib/fetch.js';
import type { AdminApi } from './admin-api.js';
import type { LiveAdminApi } from './admin-api.live.js';
import type { MockAdminApi } from './admin-api.mock.js';

/**
 * Hybrid composer: tries the live impl first; on `HttpError(501,
 * 'not_implemented')`, falls through to the mock. As live endpoints land in
 * the auth-service squash, individual methods on LiveAdminApi start
 * returning real data and the mock is bypassed for those endpoints.
 */
export class HybridAdminApi implements AdminApi {
  constructor(
    private readonly live: LiveAdminApi,
    private readonly mock: MockAdminApi,
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
      () => this.mock.listUsers(q),
    );

  getUser: AdminApi['getUser'] = (id) =>
    this.tryLive(
      () => this.live.getUser(id),
      () => this.mock.getUser(id),
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
}
