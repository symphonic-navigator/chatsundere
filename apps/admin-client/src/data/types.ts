// SPDX-License-Identifier: AGPL-3.0-only

// Client-side view-models and derivations. Wire truth lives in
// @chatsundere/shared-types; everything here is presentation-side.

import type {
  AdminAuditLogEntry,
  AdminInvitationStatus,
  AdminUserDetail,
  AdminUserSummary,
} from '@chatsundere/shared-types';

export type UserStatus = 'active' | 'suspended';

export type AuditEventCategory =
  | 'auth'
  | 'user-lifecycle'
  | 'invitation-lifecycle'
  | 'recovery'
  | 'security'
  | 'admin-action';

export interface UserRow extends AdminUserSummary {
  status: UserStatus;
}

export interface UserDetailView extends AdminUserDetail {
  status: UserStatus;
  /**
   * Derived, not fetched: the DB's partial unique index guarantees at most one
   * primary_admin, so the current primary is always the last one.
   */
  is_last_primary_admin: boolean;
}

export interface AuditRow extends AdminAuditLogEntry {
  category: AuditEventCategory;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  per_page: number;
}

export interface DashboardSummary {
  total_users: number;
  suspended_users: number;
  pending_invitations: number;
  /** Soonest expiry among the first page (≤100) of pending invitations. */
  soonest_pending_expiry: string | null;
  events_24h: number;
  recent_activity: AuditRow[];
}

export interface UserListQuery {
  search?: string;
  role?: 'user' | 'admin' | 'primary_admin' | 'all';
  status?: UserStatus | 'all';
  page?: number;
  per_page?: number;
}

export interface InvitationListQuery {
  status?: AdminInvitationStatus | 'all';
  page?: number;
  per_page?: number;
}

export interface AuditListQuery {
  event_type?: string;
  user_id?: string;
  /** Date-input value (YYYY-MM-DD); mapped to the wire `since` at start of day UTC. */
  from?: string;
  /** Date-input value (YYYY-MM-DD); mapped to the wire `until` at end of day UTC. */
  to?: string;
  page?: number;
  per_page?: number;
}

export interface CreateInvitationInput {
  role: 'user' | 'admin';
  expires_in_days: 1 | 7 | 30;
  issuer_label?: string;
  suggested_username?: string;
  note?: string;
}

/**
 * Presentation grouping for event types. Pinned in the spec (§6.3); unknown
 * types deliberately land in admin-action rather than throwing.
 */
export function deriveCategory(eventType: string): AuditEventCategory {
  if (eventType === 'wrapping_invariant_violated' || eventType === 'refresh_token.reuse_detected') {
    return 'security';
  }
  if (eventType === 'recovery_used') return 'recovery';
  if (eventType.startsWith('auth.') || eventType.startsWith('auth_method.')) return 'auth';
  if (eventType.startsWith('user.')) return 'user-lifecycle';
  if (eventType.startsWith('invitation.') || eventType.startsWith('pairing_code.')) {
    return 'invitation-lifecycle';
  }
  return 'admin-action';
}

/** A user is suspended exactly when the server has a suspended_at timestamp. */
export function deriveStatus(suspendedAt: string | null): UserStatus {
  return suspendedAt === null ? 'active' : 'suspended';
}

/** The UI offers day choices; the wire wants seconds. */
export function toExpiresInSeconds(days: 1 | 7 | 30): number {
  return days * 86_400;
}
