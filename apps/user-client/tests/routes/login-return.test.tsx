// apps/user-client/tests/routes/login-return.test.tsx
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { safeReturnTarget } from '../../src/routes/login/index.js';

describe('safeReturnTarget (spec §4.1, U-3)', () => {
  it('accepts same-origin relative paths', () => {
    expect(safeReturnTarget('/onboarding/invitation/confirm?return=%2Fapp')).toBe(
      '/onboarding/invitation/confirm?return=%2Fapp',
    );
  });
  it('rejects protocol-relative and absolute URLs', () => {
    expect(safeReturnTarget('//evil.example')).toBe('/app');
    expect(safeReturnTarget('https://evil.example')).toBe('/app');
  });
  it('defaults to /app', () => {
    expect(safeReturnTarget(null)).toBe('/app');
  });
});
