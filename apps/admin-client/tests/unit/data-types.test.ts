// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { deriveCategory, deriveStatus, toExpiresInSeconds } from '../../src/data/types.js';

describe('deriveCategory', () => {
  it.each([
    ['auth.login.success', 'auth'],
    ['auth.step_up.failed', 'auth'],
    ['auth_method.added', 'auth'],
    ['user.suspended', 'user-lifecycle'],
    ['user.role_changed', 'user-lifecycle'],
    ['invitation.created', 'invitation-lifecycle'],
    ['pairing_code.redeemed', 'invitation-lifecycle'],
    ['recovery_used', 'recovery'],
    ['wrapping_invariant_violated', 'security'],
    ['refresh_token.reuse_detected', 'security'],
    ['primary_admin.transferred', 'admin-action'],
  ] as const)('%s → %s', (eventType, category) => {
    expect(deriveCategory(eventType)).toBe(category);
  });

  it('falls back to admin-action for unknown types', () => {
    expect(deriveCategory('future.event')).toBe('admin-action');
  });
});

describe('deriveStatus', () => {
  it('is suspended when suspended_at is set', () => {
    expect(deriveStatus('2026-01-01T00:00:00Z')).toBe('suspended');
  });
  it('is active when suspended_at is null', () => {
    expect(deriveStatus(null)).toBe('active');
  });
});

describe('toExpiresInSeconds', () => {
  it.each([
    [1, 86_400],
    [7, 604_800],
    [30, 2_592_000],
  ] as const)('%s days → %s seconds', (days, seconds) => {
    expect(toExpiresInSeconds(days)).toBe(seconds);
  });
});
