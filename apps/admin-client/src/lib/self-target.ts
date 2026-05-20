// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Roles defined locally until `@chatsundere/shared-types` ships the canonical
 * Role type. Move this into shared-types when Lyra's invitation-and-pairing
 * brief settles the schema.
 *
 * Note: `shared-types` already exports `UserRole` with the same union — this
 * local alias avoids importing a type that may shift between phases.
 */
export type Role = 'primary_admin' | 'admin' | 'user';

export interface SessionLike {
  userId: string | null;
}

/** True if the session user is targeting their own account. */
export function isSelfTarget(session: SessionLike, targetUserId: string): boolean {
  return session.userId !== null && session.userId === targetUserId;
}

/** True if the role is `primary_admin`. */
export function isPrimaryAdmin(role: Role): boolean {
  return role === 'primary_admin';
}
