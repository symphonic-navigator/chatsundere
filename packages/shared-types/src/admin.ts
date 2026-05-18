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
}

export interface AdminCreateInvitationResponse {
  invitation_id: string;
  token: string;
  expires_at: string;
  qr_payload: string;
}

export interface AdminAuditLogEntry {
  id: string;
  user_id: string | null;
  actor_user_id: string | null;
  event_type: string;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface AdminAuditLogResponse {
  entries: AdminAuditLogEntry[];
  total: number;
}
