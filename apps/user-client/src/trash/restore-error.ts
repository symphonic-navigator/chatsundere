// SPDX-License-Identifier: AGPL-3.0-only
import { isProjectFsError, isProjectNotFound } from '../projects/errors.js';

/**
 * The user-facing reason a restore was refused, or null when `e` is neither a
 * path collision nor a restore into a deleted project.
 */
export function describeRestoreError(e: unknown): string | null {
  if (isProjectNotFound(e)) {
    return "Can't restore here — its project was deleted. Restore the project from Recently deleted.";
  }
  if (!isProjectFsError(e, 'AlreadyExists')) return null;
  const path = e.detail.path ?? '';
  const others = e.detail.others ?? 0;
  if (others === 0) {
    return `Can't restore: ${path} already exists. Rename or move that file, then restore again.`;
  }
  const files = others === 1 ? '1 other file' : `${others} other files`;
  return `Can't restore: ${path} and ${files} already exist. Rename or move them, then restore again.`;
}
