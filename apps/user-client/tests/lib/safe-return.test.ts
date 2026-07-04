// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { safeReturnPath } from '../../src/lib/safe-return.js';

describe('safeReturnPath — the single ?return= open-redirect guard', () => {
  it('passes a genuine site-relative path through unchanged', () => {
    expect(safeReturnPath('/app', '/fallback')).toBe('/app');
    expect(safeReturnPath('/app/account/server-linking', '/fallback')).toBe(
      '/app/account/server-linking',
    );
    expect(safeReturnPath('/onboarding/invitation?return=/app', '/fallback')).toBe(
      '/onboarding/invitation?return=/app',
    );
  });

  it('falls back on an absent target', () => {
    expect(safeReturnPath(null, '/fallback')).toBe('/fallback');
    expect(safeReturnPath(undefined, '/fallback')).toBe('/fallback');
    expect(safeReturnPath('', '/fallback')).toBe('/fallback');
  });

  it('rejects protocol-relative and scheme-bearing targets', () => {
    expect(safeReturnPath('//evil.com', '/fallback')).toBe('/fallback');
    expect(safeReturnPath('https://evil.com', '/fallback')).toBe('/fallback');
    expect(safeReturnPath('javascript:alert(1)', '/fallback')).toBe('/fallback');
    expect(safeReturnPath('/\\evil.com', '/fallback')).toBe('/fallback'); // backslash-smuggled
  });

  it('rejects control-char-smuggled targets the URL parser would strip (Larissa M-2)', () => {
    // `?return=/%09/evil.com` decodes to a tab at index 1: the char-check must
    // reject it before the slash checks, or the browser resolves it to //evil.com.
    expect(safeReturnPath('/\t/evil.com', '/fallback')).toBe('/fallback');
    expect(safeReturnPath('/\n/evil.com', '/fallback')).toBe('/fallback');
    expect(safeReturnPath('/\r/evil.com', '/fallback')).toBe('/fallback');
    expect(safeReturnPath('//evil.com', '/fallback')).toBe('/fallback');
  });
});
