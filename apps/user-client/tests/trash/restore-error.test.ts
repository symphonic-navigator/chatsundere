// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { fsError, projectNotFound } from '../../src/projects/errors.js';
import { describeRestoreError } from '../../src/trash/restore-error.js';

describe('describeRestoreError', () => {
  it('names the colliding path and the way out', () => {
    expect(describeRestoreError(fsError('AlreadyExists', { path: '/notes/plan.md' }))).toBe(
      "Can't restore: /notes/plan.md already exists. Rename or move that file, then restore again.",
    );
    expect(describeRestoreError(fsError('AlreadyExists', { path: '/a.md', others: 0 }))).toBe(
      "Can't restore: /a.md already exists. Rename or move that file, then restore again.",
    );
  });

  it('counts the other collisions, singular and plural', () => {
    expect(
      describeRestoreError(fsError('AlreadyExists', { path: '/notes/plan.md', others: 1 })),
    ).toBe(
      "Can't restore: /notes/plan.md and 1 other file already exist. Rename or move them, then restore again.",
    );
    expect(
      describeRestoreError(fsError('AlreadyExists', { path: '/notes/plan.md', others: 3 })),
    ).toBe(
      "Can't restore: /notes/plan.md and 3 other files already exist. Rename or move them, then restore again.",
    );
  });

  it('explains a restore into a deleted project', () => {
    expect(describeRestoreError(projectNotFound('p1'))).toBe(
      "Can't restore here — its project was deleted. Restore the project from Recently deleted.",
    );
  });

  it('returns null for anything else', () => {
    expect(describeRestoreError(fsError('NotFound', { path: '/a.md' }))).toBeNull();
    expect(describeRestoreError(fsError('QuotaExceeded', {}))).toBeNull();
    expect(describeRestoreError(new Error('boom'))).toBeNull();
  });
});
