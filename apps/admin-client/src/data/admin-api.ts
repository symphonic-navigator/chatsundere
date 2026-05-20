// SPDX-License-Identifier: AGPL-3.0-only

// TODO: move these wire-shape types to packages/shared-types once Lyra's
// invitation-and-pairing brief settles the canonical schemas.

import type { Role } from '../lib/self-target.js';

export type UserStatus = 'active' | 'suspended';

export interface AuthMethodSummary {
  id: string;
  label: string;
  type: 'passphrase' | 'passkey';
  last_used_at: string | null;
}

export interface UserSummary {
  id: string;
  username: string;
  role: Role;
  status: UserStatus;
  created_at: string;
  last_login_at: string | null;
}

export interface UserDetail extends UserSummary {
  auth_methods: AuthMethodSummary[];
  /**
   * True when this user is the only `primary_admin` on the server. The UI
   * disables demote / delete for the last primary admin so the operator is
   * forced to call `transferPrimary` first — losing the only primary admin
   * leaves the server unmanageable.
   *
   * Optional for forward-compatibility with older servers that do not yet
   * compute the flag; an absent value is treated as `false` (i.e. no extra
   * gating). The mock + hybrid composer compute it locally for dev QA.
   */
  is_last_primary_admin?: boolean;
}

export type InvitationStatus = 'pending' | 'redeemed' | 'expired' | 'revoked';

export interface InvitationSummary {
  id: string;
  role: Role;
  status: InvitationStatus;
  redeemed_by: string | null;
  created_at: string;
  expires_at: string;
  issuer_label: string | null;
}

export interface InvitationCreated extends InvitationSummary {
  qr_payload: string;
  url: string;
}

export interface CreateInvitationInput {
  role: 'user' | 'admin' | 'primary_admin';
  expires_in_days: 1 | 7 | 30;
  issuer_label?: string;
}

export type AuditEventCategory =
  | 'auth'
  | 'user-lifecycle'
  | 'invitation-lifecycle'
  | 'recovery'
  | 'admin-action';

export interface AuditEvent {
  id: string;
  timestamp: string;
  event_type: string;
  category: AuditEventCategory;
  actor_id: string | null;
  actor_username: string | null;
  subject_id: string | null;
  subject_username: string | null;
  metadata: Record<string, unknown>;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  per_page: number;
}

export interface UserListQuery {
  search?: string;
  role?: Role | 'all';
  status?: UserStatus | 'all';
  page?: number;
  per_page?: number;
}

export interface InvitationListQuery {
  status?: InvitationStatus | 'all';
  page?: number;
  per_page?: number;
}

export interface AuditListQuery {
  category?: AuditEventCategory | 'all';
  user_id?: string;
  from?: string;
  to?: string;
  page?: number;
  per_page?: number;
}

export interface DashboardSummary {
  total_users: number;
  pending_invitations: number;
  suspended_users: number;
  recent_activity: AuditEvent[];
}

export interface AdminApi {
  // Users
  listUsers(query: UserListQuery): Promise<Paged<UserSummary>>;
  getUser(id: string): Promise<UserDetail>;
  suspendUser(id: string): Promise<void>;
  unsuspendUser(id: string): Promise<void>;
  deleteUser(id: string): Promise<void>;
  changeRole(id: string, role: 'user' | 'admin'): Promise<void>;
  transferPrimary(toUserId: string): Promise<void>;

  // Invitations
  listInvitations(query: InvitationListQuery): Promise<Paged<InvitationSummary>>;
  createInvitation(input: CreateInvitationInput): Promise<InvitationCreated>;
  revokeInvitation(id: string): Promise<void>;

  // Audit
  listAudit(query: AuditListQuery): Promise<Paged<AuditEvent>>;

  // Dashboard
  getDashboardSummary(): Promise<DashboardSummary>;
}
