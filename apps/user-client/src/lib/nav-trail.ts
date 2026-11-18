// SPDX-License-Identifier: AGPL-3.0-only

/**
 * The trail of a history entry: the pathnames of the in-app entries behind it,
 * oldest first (spec "Back means one thing", 2026-11-18). Pathnames only, never
 * search or state, so it carries no content.
 */
export type Trail = readonly string[];

/** At most this many pathnames are kept behind an entry. */
export const TRAIL_CAP = 50;

/** How the current entry was reached, with what is needed to derive its trail. */
export type TrailStep =
  | { type: 'PUSH'; prevTrail: Trail; prevPathname: string; idx?: number | null }
  | { type: 'REPLACE'; prevTrail: Trail; prevPathname: string; idx?: number | null }
  | { type: 'POP'; stamp: unknown; idx?: number | null };

function isTrail(value: unknown): value is Trail {
  return Array.isArray(value) && value.every((v) => typeof v === 'string');
}

/** The trail of a newly reached entry. */
export function nextTrail(step: TrailStep): string[] {
  let trail: string[];
  if (step.type === 'PUSH') trail = [...step.prevTrail, step.prevPathname];
  else if (step.type === 'REPLACE') trail = [...step.prevTrail];
  else trail = isTrail(step.stamp) ? [...step.stamp] : [];
  // React Router's idx counts the entries behind this one in this document, so a
  // trail can never honestly be longer.
  const limit =
    typeof step.idx === 'number' ? Math.min(TRAIL_CAP, Math.max(0, step.idx)) : TRAIL_CAP;
  return trail.length > limit ? trail.slice(trail.length - limit) : trail;
}

/** The pathname of a route target, without search or hash. */
export function pathnameOf(to: string): string {
  const cut = to.search(/[?#]/);
  return cut === -1 ? to : to.slice(0, cut);
}

/** Steps back to the nearest entry behind whose pathname is `to`'s, or null. */
export function findReturnDepth(trail: Trail, to: string): number | null {
  const target = pathnameOf(to);
  for (let i = trail.length - 1; i >= 0; i--) {
    if (trail[i] === target) return trail.length - i;
  }
  return null;
}
