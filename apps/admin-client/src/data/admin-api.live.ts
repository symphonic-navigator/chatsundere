// SPDX-License-Identifier: AGPL-3.0-only
import { HttpError } from '../lib/fetch.js';
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

function notImplemented(): never {
  throw new HttpError(501, 'not_implemented', 'admin endpoint not yet implemented');
}

/**
 * Live admin API against the running auth-service. Every method throws
 * `HttpError(501, 'not_implemented')` today; concrete implementations will
 * land in the auth-service squash once Lyra's brief settles the wire shapes.
 * The hybrid composer falls through to the mock on 501s.
 */
export class LiveAdminApi implements AdminApi {
  constructor(private readonly _baseUrl: string) {}

  async listUsers(_q: UserListQuery): Promise<Paged<UserSummary>> {
    return notImplemented();
  }
  async getUser(_id: string): Promise<UserDetail> {
    return notImplemented();
  }
  async suspendUser(_id: string): Promise<void> {
    return notImplemented();
  }
  async unsuspendUser(_id: string): Promise<void> {
    return notImplemented();
  }
  async deleteUser(_id: string): Promise<void> {
    return notImplemented();
  }
  async changeRole(_id: string, _role: 'user' | 'admin'): Promise<void> {
    return notImplemented();
  }
  async transferPrimary(_id: string): Promise<void> {
    return notImplemented();
  }
  async listInvitations(_q: InvitationListQuery): Promise<Paged<InvitationSummary>> {
    return notImplemented();
  }
  async createInvitation(_i: CreateInvitationInput): Promise<InvitationCreated> {
    return notImplemented();
  }
  async revokeInvitation(_id: string): Promise<void> {
    return notImplemented();
  }
  async listAudit(_q: AuditListQuery): Promise<Paged<AuditEvent>> {
    return notImplemented();
  }
  async getDashboardSummary(): Promise<DashboardSummary> {
    return notImplemented();
  }
}
