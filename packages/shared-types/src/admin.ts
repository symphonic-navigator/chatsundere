// SPDX-License-Identifier: MIT

import type { ServerAuthMethodType, UserRole } from './auth.js';

export interface AdminUserSummary {
  id: string;
  username: string;
  role: UserRole;
  suspended_at: string | null;
  created_at: string;
  last_login_at: string | null;
}

export interface AdminUserListResponse {
  users: AdminUserSummary[];
  total: number;
}

export interface AdminAuthMethodSummary {
  id: string;
  method_type: ServerAuthMethodType;
  label: string | null;
  created_at: string;
  last_used_at: string | null;
}

export interface AdminUserDetail extends AdminUserSummary {
  auth_methods: AdminAuthMethodSummary[];
}

export interface AdminCreateInvitationRequest {
  role: 'admin' | 'user';
  expires_in_seconds: number;
  issuer_label?: string;
  suggested_username?: string;
  note?: string;
}

export interface AdminCreateInvitationResponse {
  invitation_id: string;
  /** The one-time 10-character join code. Never returned again after this response. */
  code: string;
  /** Deep-link URL embedding the code as a fragment; QR-encodable as-is. */
  qr_url: string;
  expires_at: string;
  state: 'active';
}

export type AdminInvitationStatus = 'pending' | 'redeemed' | 'revoked' | 'expired';

export interface AdminInvitationSummary {
  id: string;
  role: 'admin' | 'user' | 'primary_admin';
  issuer_label: string | null;
  suggested_username: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
  expires_at: string;
  redeemed_at: string | null;
  redeemed_by_user_id: string | null;
  revoked_at: string | null;
  attempt_count: number;
  status: AdminInvitationStatus;
}

export interface AdminInvitationListResponse {
  invitations: AdminInvitationSummary[];
  total: number;
}

export interface AdminChangeRoleRequest {
  role: 'admin' | 'user';
}

export interface AdminTransferPrimaryRequest {
  target_user_id: string;
}

export interface AdminAuditLogEntry {
  id: string;
  user_id: string | null;
  actor_user_id: string | null;
  /** Username of user_id at query time; null when the user is deleted. */
  user_username: string | null;
  /** Username of actor_user_id at query time; null when the actor is deleted. */
  actor_username: string | null;
  event_type: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface AdminAuditLogResponse {
  entries: AdminAuditLogEntry[];
  total: number;
}
