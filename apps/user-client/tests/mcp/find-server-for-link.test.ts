// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import type { McpServerRow } from '../../src/boot/client-data-db.js';
import { findServerForLink } from '../../src/mcp/find-server-for-link.js';

const row = (over: Partial<McpServerRow>): McpServerRow => ({
  id: 's',
  name: 'S',
  url: 'https://example.com/mcp',
  prefix: 's',
  auth: null,
  onByDefault: true,
  autoRun: false,
  allowDirect: true,
  enabled: true,
  routing: null,
  resolvedEndpoint: null,
  tools: [],
  hiddenTools: [],
  lastTestedAt: null,
  lastError: null,
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

describe('findServerForLink', () => {
  it('matches a row whose URL is exactly the link', () => {
    const r = row({ url: 'https://example.com/mcp' });
    expect(findServerForLink([r], 'https://example.com/mcp')).toBe(r);
  });

  it('matches case-insensitively on scheme and host', () => {
    const r = row({ url: 'https://example.com/mcp' });
    expect(findServerForLink([r], 'HTTPS://Example.COM/mcp')).toBe(r);
  });

  it('matches a row stored at the /mcp variant of the link', () => {
    const r = row({ url: 'https://example.com/mcp' });
    expect(findServerForLink([r], 'https://example.com')).toBe(r);
    expect(findServerForLink([r], 'https://example.com/')).toBe(r);
  });

  it('matches the /mcp variant below a path', () => {
    const r = row({ url: 'https://example.com/api/mcp' });
    expect(findServerForLink([r], 'https://example.com/api')).toBe(r);
  });

  it('does not form a double /mcp variant', () => {
    const r = row({ url: 'https://example.com/mcp/mcp' });
    expect(findServerForLink([r], 'https://example.com/mcp')).toBeUndefined();
    expect(findServerForLink([r], 'https://example.com/mcp/')).toBeUndefined();
  });

  it('ignores one trailing slash on either side', () => {
    const r = row({ url: 'https://example.com/mcp/' });
    expect(findServerForLink([r], 'https://example.com/mcp')).toBe(r);
    const s = row({ url: 'https://example.com/mcp' });
    expect(findServerForLink([s], 'https://example.com/mcp/')).toBe(s);
  });

  it('does not match another path', () => {
    const r = row({ url: 'https://example.com/other' });
    expect(findServerForLink([r], 'https://example.com/mcp')).toBeUndefined();
    expect(findServerForLink([r], 'https://example.com')).toBeUndefined();
  });

  it('does not match the bare origin when the link has the /mcp path', () => {
    const r = row({ url: 'https://example.com' });
    expect(findServerForLink([r], 'https://example.com/mcp')).toBeUndefined();
  });

  it('does not match another host', () => {
    const r = row({ url: 'https://other.example/mcp' });
    expect(findServerForLink([r], 'https://example.com/mcp')).toBeUndefined();
  });

  it('skips a row whose URL does not parse, without throwing', () => {
    const bad = row({ id: 'bad', url: 'not a url' });
    const creds = row({ id: 'creds', url: 'https://u:p@example.com/mcp' });
    const good = row({ id: 'good', url: 'https://example.com/mcp' });
    expect(findServerForLink([bad, creds, good], 'https://example.com/mcp')).toBe(good);
    expect(findServerForLink([bad], 'https://example.com/mcp')).toBeUndefined();
  });

  it('returns undefined for a link that does not canonicalise', () => {
    const r = row({ url: 'https://example.com/mcp' });
    expect(findServerForLink([r], 'not a url')).toBeUndefined();
    expect(findServerForLink([r], 'ftp://example.com/mcp')).toBeUndefined();
  });

  it('returns the first of two matches in input (createdAt) order', () => {
    const older = row({ id: 'older', url: 'https://example.com', createdAt: 1 });
    const newer = row({ id: 'newer', url: 'https://example.com/mcp', createdAt: 2 });
    expect(findServerForLink([older, newer], 'https://example.com')).toBe(older);
    expect(findServerForLink([newer, older], 'https://example.com')).toBe(newer);
  });

  it('returns undefined for no rows', () => {
    expect(findServerForLink([], 'https://example.com/mcp')).toBeUndefined();
  });

  it('forms the /mcp variant as the check does, query included (review, 2026-11-18)', () => {
    const appended = row({ id: 'appended', url: 'https://ex.com/api?k=v/mcp' });
    expect(findServerForLink([appended], 'https://ex.com/api?k=v')).toBe(appended);
    const onPath = row({ id: 'on-path', url: 'https://ex.com/api/mcp?k=v' });
    expect(findServerForLink([onPath], 'https://ex.com/api?k=v')).toBeUndefined();
  });

  it('strips every trailing slash before forming the variants, as the check does', () => {
    const exact = row({ id: 'exact', url: 'https://ex.com/api' });
    expect(findServerForLink([exact], 'https://ex.com/api//')).toBe(exact);
    const doubled = row({ id: 'doubled', url: 'https://ex.com/mcp/mcp' });
    expect(findServerForLink([doubled], 'https://ex.com/mcp//')).toBeUndefined();
  });
});
