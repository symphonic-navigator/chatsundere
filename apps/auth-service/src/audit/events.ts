// SPDX-License-Identifier: AGPL-3.0-only
import { type BaseIssue, type BaseSchema, object, optional, picklist, string } from 'valibot';

export const AUDIT_EVENT_TYPES = [
  'user.linked',
  'user.suspended',
  'user.unsuspended',
  'user.deleted_by_admin',
  'user.self_deleted',
  'user.role_changed',
  'user.username_changed',
  'primary_admin.transferred',
  'invitation.created',
  'invitation.revoked',
  'invitation.redeemed',
  'auth_method.added',
  'auth_method.removed',
  'auth_method.passphrase_changed',
  'auth.login.success',
  'auth.login.failed',
  'auth.logout',
  'auth.step_up.confirmed',
  'auth.step_up.failed',
  'recovery_used',
  'refresh_token.reuse_detected',
] as const;

export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];

const userLinkedMeta = object({
  role: picklist(['primary_admin', 'admin', 'user']),
  invitation_id: string(),
});

const userRoleChangedMeta = object({
  from_role: picklist(['primary_admin', 'admin', 'user']),
  to_role: picklist(['primary_admin', 'admin', 'user']),
});

const invitationCreatedMeta = object({
  invitation_id: string(),
  role: picklist(['primary_admin', 'admin', 'user']),
  expires_at: string(),
});

const invitationRevokedMeta = object({ invitation_id: string() });
const invitationRedeemedMeta = object({
  invitation_id: string(),
  role: picklist(['primary_admin', 'admin', 'user']),
});

const authMethodMeta = object({
  method_type: picklist(['opaque', 'passkey']),
  label: optional(string()),
});

const authLoginSuccessMeta = object({
  method_type: picklist(['opaque', 'passkey']),
});

const authLoginFailedMeta = object({
  method_type: picklist(['opaque', 'passkey']),
  reason: picklist(['bad_credentials', 'not_found', 'suspended', 'expired']),
});

const authLogoutMeta = object({ scope: picklist(['this_device', 'all']) });

const stepUpConfirmedMeta = object({
  method_type: picklist(['opaque', 'passkey']),
  tier: picklist(['t1', 't3', 't4']),
});

const stepUpFailedMeta = object({
  method_type: picklist(['opaque', 'passkey']),
  tier: picklist(['t1', 't3', 't4']),
  reason: picklist(['auth_failed', 'verify_failed', 'uv_required']),
});

const primaryAdminTransferredMeta = object({ previous_primary_admin_id: string() });

const refreshTokenReuseMeta = object({ family_id: string() });

const emptyMeta = object({});

export const AUDIT_EVENT_SCHEMAS: Record<
  AuditEventType,
  BaseSchema<unknown, unknown, BaseIssue<unknown>>
> = {
  'user.linked': userLinkedMeta,
  'user.suspended': emptyMeta,
  'user.unsuspended': emptyMeta,
  'user.deleted_by_admin': emptyMeta,
  'user.self_deleted': emptyMeta,
  'user.role_changed': userRoleChangedMeta,
  'user.username_changed': emptyMeta,
  'primary_admin.transferred': primaryAdminTransferredMeta,
  'invitation.created': invitationCreatedMeta,
  'invitation.revoked': invitationRevokedMeta,
  'invitation.redeemed': invitationRedeemedMeta,
  'auth_method.added': authMethodMeta,
  'auth_method.removed': authMethodMeta,
  'auth_method.passphrase_changed': emptyMeta,
  'auth.login.success': authLoginSuccessMeta,
  'auth.login.failed': authLoginFailedMeta,
  'auth.logout': authLogoutMeta,
  'auth.step_up.confirmed': stepUpConfirmedMeta,
  'auth.step_up.failed': stepUpFailedMeta,
  recovery_used: emptyMeta,
  'refresh_token.reuse_detected': refreshTokenReuseMeta,
};
