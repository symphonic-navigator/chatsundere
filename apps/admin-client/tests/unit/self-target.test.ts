// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { isPrimaryAdmin, isSelfTarget } from '../../src/lib/self-target.js';

describe('isSelfTarget', () => {
  it('returns true when target id matches session user id', () => {
    expect(isSelfTarget({ userId: 'u-1' }, 'u-1')).toBe(true);
  });

  it('returns false when ids differ', () => {
    expect(isSelfTarget({ userId: 'u-1' }, 'u-2')).toBe(false);
  });

  it('returns false when session has no userId', () => {
    expect(isSelfTarget({ userId: null }, 'u-1')).toBe(false);
  });
});

describe('isPrimaryAdmin', () => {
  it('returns true for primary_admin role', () => {
    expect(isPrimaryAdmin('primary_admin')).toBe(true);
  });

  it('returns false for admin role', () => {
    expect(isPrimaryAdmin('admin')).toBe(false);
  });

  it('returns false for user role', () => {
    expect(isPrimaryAdmin('user')).toBe(false);
  });
});
