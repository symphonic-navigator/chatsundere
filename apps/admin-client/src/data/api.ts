// SPDX-License-Identifier: AGPL-3.0-only

// The one live data layer. Every function talks to auth-service through
// apiFetch (bearer auth + the step-up gate) and returns view-models from
// ./types.js. Wire truth: @chatsundere/shared-types.

import type {
  AdminAuditLogResponse,
  AdminCreateInvitationRequest,
  AdminCreateInvitationResponse,
  AdminInvitationListResponse,
  AdminInvitationSummary,
  AdminUserDetail,
  AdminUserListResponse,
} from '@chatsundere/shared-types';
import { env } from '../env.js';
import { apiFetch } from '../lib/fetch.js';
import {
  type AuditListQuery,
  type AuditRow,
  type CreateInvitationInput,
  type DashboardSummary,
  type InvitationListQuery,
  type Paged,
  type UserDetailView,
  type UserListQuery,
  type UserRow,
  deriveCategory,
  deriveStatus,
  toExpiresInSeconds,
} from './types.js';

const DEFAULT_PER_PAGE = 20;

function pagination(query: { page?: number; per_page?: number }): {
  page: number;
  perPage: number;
  params: URLSearchParams;
} {
  const page = Math.max(1, query.page ?? 1);
  const perPage = query.per_page ?? DEFAULT_PER_PAGE;
  const params = new URLSearchParams();
  params.set('limit', String(perPage));
  params.set('offset', String((page - 1) * perPage));
  return { page, perPage, params };
}

export async function listUsers(query: UserListQuery): Promise<Paged<UserRow>> {
  const { page, perPage, params } = pagination(query);
  if (query.search) params.set('q', query.search);
  if (query.role && query.role !== 'all') params.set('role', query.role);
  if (query.status && query.status !== 'all') params.set('status', query.status);
  const res = await apiFetch<AdminUserListResponse>({
    baseUrl: env.VITE_AUTH_URL,
    path: `/api/v1/admin/users?${params.toString()}`,
    authMode: 'bearer',
  });
  return {
    items: res.users.map((u) => ({ ...u, status: deriveStatus(u.suspended_at) })),
    total: res.total,
    page,
    per_page: perPage,
  };
}

export async function getUser(id: string): Promise<UserDetailView> {
  const res = await apiFetch<AdminUserDetail>({
    baseUrl: env.VITE_AUTH_URL,
    path: `/api/v1/admin/users/${encodeURIComponent(id)}`,
    authMode: 'bearer',
  });
  return {
    ...res,
    status: deriveStatus(res.suspended_at),
    is_last_primary_admin: res.role === 'primary_admin',
  };
}

export async function suspendUser(id: string): Promise<void> {
  await apiFetch<{ ok: true }>({
    baseUrl: env.VITE_AUTH_URL,
    path: `/api/v1/admin/users/${encodeURIComponent(id)}/suspend`,
    method: 'POST',
    authMode: 'bearer',
  });
}

export async function unsuspendUser(id: string): Promise<void> {
  await apiFetch<{ ok: true }>({
    baseUrl: env.VITE_AUTH_URL,
    path: `/api/v1/admin/users/${encodeURIComponent(id)}/unsuspend`,
    method: 'POST',
    authMode: 'bearer',
  });
}

export async function deleteUser(id: string): Promise<void> {
  await apiFetch<{ ok: true }>({
    baseUrl: env.VITE_AUTH_URL,
    path: `/api/v1/admin/users/${encodeURIComponent(id)}`,
    method: 'DELETE',
    authMode: 'bearer',
  });
}

export async function changeRole(id: string, role: 'admin' | 'user'): Promise<void> {
  await apiFetch<{ ok: true }>({
    baseUrl: env.VITE_AUTH_URL,
    path: `/api/v1/admin/users/${encodeURIComponent(id)}/role`,
    json: { role },
    authMode: 'bearer',
  });
}

export async function transferPrimary(targetUserId: string): Promise<void> {
  await apiFetch<{ ok: true }>({
    baseUrl: env.VITE_AUTH_URL,
    path: '/api/v1/admin/transfer-primary',
    json: { target_user_id: targetUserId },
    authMode: 'bearer',
  });
}

export async function listInvitations(
  query: InvitationListQuery,
): Promise<Paged<AdminInvitationSummary>> {
  const { page, perPage, params } = pagination(query);
  if (query.status && query.status !== 'all') params.set('status', query.status);
  const res = await apiFetch<AdminInvitationListResponse>({
    baseUrl: env.VITE_AUTH_URL,
    path: `/api/v1/admin/invitations?${params.toString()}`,
    authMode: 'bearer',
  });
  return { items: res.invitations, total: res.total, page, per_page: perPage };
}

export async function createInvitation(
  input: CreateInvitationInput,
): Promise<AdminCreateInvitationResponse> {
  const body: AdminCreateInvitationRequest = {
    role: input.role,
    expires_in_seconds: toExpiresInSeconds(input.expires_in_days),
    ...(input.issuer_label ? { issuer_label: input.issuer_label } : {}),
    ...(input.suggested_username ? { suggested_username: input.suggested_username } : {}),
    ...(input.note ? { note: input.note } : {}),
  };
  return apiFetch<AdminCreateInvitationResponse>({
    baseUrl: env.VITE_AUTH_URL,
    path: '/api/v1/admin/invitations',
    json: body,
    authMode: 'bearer',
  });
}

export async function revokeInvitation(id: string): Promise<void> {
  await apiFetch<{ ok: true }>({
    baseUrl: env.VITE_AUTH_URL,
    path: `/api/v1/admin/invitations/${encodeURIComponent(id)}`,
    method: 'DELETE',
    authMode: 'bearer',
  });
}

function toAuditRow(entry: AdminAuditLogResponse['entries'][number]): AuditRow {
  return { ...entry, category: deriveCategory(entry.event_type) };
}

export async function listAudit(query: AuditListQuery): Promise<Paged<AuditRow>> {
  const { page, perPage, params } = pagination(query);
  if (query.event_type) params.set('event_type', query.event_type);
  if (query.user_id) params.set('user_id', query.user_id);
  if (query.from) params.set('since', `${query.from}T00:00:00.000Z`);
  if (query.to) params.set('until', `${query.to}T23:59:59.999Z`);
  const res = await apiFetch<AdminAuditLogResponse>({
    baseUrl: env.VITE_AUTH_URL,
    path: `/api/v1/admin/audit-log?${params.toString()}`,
    authMode: 'bearer',
  });
  return { items: res.entries.map(toAuditRow), total: res.total, page, per_page: perPage };
}

export async function getDashboardSummary(): Promise<DashboardSummary> {
  const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const [allUsers, suspended, pending, last24h, recent] = await Promise.all([
    listUsers({ page: 1, per_page: 1 }),
    listUsers({ status: 'suspended', page: 1, per_page: 1 }),
    listInvitations({ status: 'pending', page: 1, per_page: 100 }),
    apiFetch<AdminAuditLogResponse>({
      baseUrl: env.VITE_AUTH_URL,
      path: `/api/v1/admin/audit-log?since=${encodeURIComponent(sinceIso)}&limit=1`,
      authMode: 'bearer',
    }),
    listAudit({ page: 1, per_page: 10 }),
  ]);
  const soonest = pending.items.reduce<string | null>(
    (min, inv) => (min === null || inv.expires_at < min ? inv.expires_at : min),
    null,
  );
  return {
    total_users: allUsers.total,
    suspended_users: suspended.total,
    pending_invitations: pending.total,
    soonest_pending_expiry: soonest,
    events_24h: last24h.total,
    recent_activity: recent.items,
  };
}
