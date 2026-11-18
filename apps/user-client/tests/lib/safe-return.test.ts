// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { readReturnTo, safeReturnPath, withReturn } from '../../src/lib/safe-return.js';

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

describe('readReturnTo — the chat a page was opened from', () => {
  it('reads a site-relative ?return=', () => {
    expect(readReturnTo(new URLSearchParams('return=%2Fapp%2Fchat%2Fc1'))).toBe('/app/chat/c1');
  });

  it('is null when there is none, or it would leave the site', () => {
    expect(readReturnTo(new URLSearchParams(''))).toBeNull();
    expect(readReturnTo(new URLSearchParams('return='))).toBeNull();
    expect(readReturnTo(new URLSearchParams('return=%2F%2Fevil.example'))).toBeNull();
    expect(
      readReturnTo(new URLSearchParams(`return=${encodeURIComponent('https://evil.example')}`)),
    ).toBeNull();
  });
});

describe('withReturn — carrying the return to the next page', () => {
  it('leaves the path alone without a return', () => {
    expect(withReturn('/app/integrations/new', null)).toBe('/app/integrations/new');
  });

  it('appends the return, encoded', () => {
    expect(withReturn('/app/integrations/new', '/app/chat/c1')).toBe(
      `/app/integrations/new?return=${encodeURIComponent('/app/chat/c1')}`,
    );
  });

  it('appends with & to a path that already has a query', () => {
    expect(withReturn('/app/integrations/new?tab=key', '/app/chat/c1')).toBe(
      `/app/integrations/new?tab=key&return=${encodeURIComponent('/app/chat/c1')}`,
    );
  });

  it('round-trips through readReturnTo', () => {
    const nested = withReturn('/app/integrations/o1', '/app/chat/c1');
    const url = new URL(withReturn('/app/account/server-linking', nested), 'https://x.example');
    expect(readReturnTo(url.searchParams)).toBe(nested);
  });
});
