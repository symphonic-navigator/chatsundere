// SPDX-License-Identifier: AGPL-3.0-only
import { isProjectFsError } from '../projects/errors.js';

/** The user-facing reason a restore was refused, or null when `e` is not a path collision. */
export function describeRestoreError(e: unknown): string | null {
  if (!isProjectFsError(e, 'AlreadyExists')) return null;
  const path = e.detail.path ?? '';
  const others = e.detail.others ?? 0;
  const more = others > 0 ? ` (and ${others} more)` : '';
  return `Can't restore: ${path}${more} already exists. Rename or move that file, then restore again.`;
}
