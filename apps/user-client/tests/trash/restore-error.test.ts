// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { fsError } from '../../src/projects/errors.js';
import { describeRestoreError } from '../../src/trash/restore-error.js';

describe('describeRestoreError', () => {
  it('names the colliding path and the way out', () => {
    expect(describeRestoreError(fsError('AlreadyExists', { path: '/notes/plan.md' }))).toBe(
      "Can't restore: /notes/plan.md already exists. Rename or move that file, then restore again.",
    );
  });

  it('counts the other collisions', () => {
    expect(
      describeRestoreError(fsError('AlreadyExists', { path: '/notes/plan.md', others: 3 })),
    ).toBe(
      "Can't restore: /notes/plan.md (and 3 more) already exists. Rename or move that file, then restore again.",
    );
    expect(describeRestoreError(fsError('AlreadyExists', { path: '/a.md', others: 0 }))).toBe(
      "Can't restore: /a.md already exists. Rename or move that file, then restore again.",
    );
  });

  it('returns null for anything else', () => {
    expect(describeRestoreError(fsError('NotFound', { path: '/a.md' }))).toBeNull();
    expect(describeRestoreError(new Error('boom'))).toBeNull();
  });
});
