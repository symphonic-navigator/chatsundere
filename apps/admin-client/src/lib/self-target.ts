// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Roles defined locally until `@chatsundere/shared-types` ships the canonical
 * Role type. Move this into shared-types when Lyra's invitation-and-pairing
 * brief settles the schema.
 */
export type Role = 'primary_admin' | 'admin' | 'user';

export interface SessionLike {
  userId: string | null;
}

/**
 * True if the session user is targeting their own account.
 *
 * Defensive: rejects null and empty-string IDs on either side so a malformed
 * response (e.g. a UserDetail missing `id`) can never accidentally evaluate
 * as a self-target. Trust boundary remains the server; this predicate is the
 * client-side mirror.
 */
export function isSelfTarget(session: SessionLike, targetUserId: string): boolean {
  if (!session.userId || !targetUserId) return false;
  return session.userId === targetUserId;
}

/** True if the role is `primary_admin`. */
export function isPrimaryAdmin(role: Role): boolean {
  return role === 'primary_admin';
}
