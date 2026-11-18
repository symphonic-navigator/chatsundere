// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import {
  emphasisSplit,
  linksInText,
  normaliseConnectorLink,
  userWroteLink,
} from '../../src/tools/connector-link.js';

function refusal(raw: string): string | null {
  const r = normaliseConnectorLink(raw);
  return r.ok ? null : r.reason;
}

describe('normaliseConnectorLink', () => {
  it('accepts a plain https link and returns its href and host', () => {
    expect(normaliseConnectorLink('https://mcp.kumbu.example/mcp')).toEqual({
      ok: true,
      url: 'https://mcp.kumbu.example/mcp',
      host: 'mcp.kumbu.example',
    });
  });

  it('completes a missing scheme with https', () => {
    expect(normaliseConnectorLink('mcp.kumbu.example/mcp')).toEqual({
      ok: true,
      url: 'https://mcp.kumbu.example/mcp',
      host: 'mcp.kumbu.example',
    });
  });

  it('completes a missing scheme when the link carries a port', () => {
    const r = normaliseConnectorLink('mcp.kumbu.example:8443/mcp');
    expect(r).toEqual({
      ok: true,
      url: 'https://mcp.kumbu.example:8443/mcp',
      host: 'mcp.kumbu.example',
    });
  });

  it('trims surrounding space and keeps a trailing slash in the href', () => {
    const r = normaliseConnectorLink('  https://mcp.kumbu.example/mcp/ \n');
    expect(r).toEqual({
      ok: true,
      url: 'https://mcp.kumbu.example/mcp/',
      host: 'mcp.kumbu.example',
    });
  });

  it('lowercases the host', () => {
    const r = normaliseConnectorLink('https://MCP.Kumbu.Example/MCP');
    expect(r).toEqual({
      ok: true,
      url: 'https://mcp.kumbu.example/MCP',
      host: 'mcp.kumbu.example',
    });
  });

  it('turns an internationalised host into punycode', () => {
    const r = normaliseConnectorLink('https://bücher.example/mcp');
    expect(r).toEqual({
      ok: true,
      url: 'https://xn--bcher-kva.example/mcp',
      host: 'xn--bcher-kva.example',
    });
  });

  it('percent-encodes non-ASCII characters in the path and query', () => {
    const r = normaliseConnectorLink('https://mcp.kumbu.example/über?q=ä');
    expect(r.ok && r.url).toBe('https://mcp.kumbu.example/%C3%BCber?q=%C3%A4');
  });

  it('strips a tab or newline inside the link', () => {
    const r = normaliseConnectorLink('https://mcp.kumbu.ex\tample/m\ncp');
    expect(r.ok && r.url).toBe('https://mcp.kumbu.example/mcp');
  });

  describe('rule: a valid link', () => {
    it('refuses text that does not parse', () => {
      expect(refusal('https://exa mple.com/mcp')).toBe('invalid');
      expect(refusal('')).toBe('invalid');
      expect(refusal('https://')).toBe('invalid');
    });
  });

  describe('rule: https only', () => {
    it('passes https', () => {
      expect(refusal('https://example.com/mcp')).toBeNull();
    });

    it('refuses http and other schemes', () => {
      expect(refusal('http://example.com/mcp')).toBe('not-https');
      expect(refusal('ftp://example.com/mcp')).toBe('not-https');
      expect(refusal('javascript:alert(1)')).toBe('not-https');
    });
  });

  describe('rule: no user name or password', () => {
    it('passes a link without credentials, even with an @ in the path', () => {
      expect(refusal('https://example.com/@team/mcp')).toBeNull();
    });

    it('refuses a user name', () => {
      expect(refusal('https://user@example.com/mcp')).toBe('userinfo');
    });

    it('refuses a user name and password', () => {
      expect(refusal('https://user:pw@example.com/mcp')).toBe('userinfo');
    });

    it('refuses a password alone', () => {
      expect(refusal('https://:pw@example.com/mcp')).toBe('userinfo');
    });
  });

  describe('rule: no fragment', () => {
    it('passes a link with a query and an encoded hash', () => {
      expect(refusal('https://example.com/mcp?a=%23b')).toBeNull();
    });

    it('refuses a fragment', () => {
      expect(refusal('https://example.com/mcp#frag')).toBe('fragment');
      expect(refusal('https://evil.example/mcp#@mcp.kumbu.example')).toBe('fragment');
    });

    it('refuses an empty fragment', () => {
      expect(refusal('https://example.com/mcp#')).toBe('fragment');
    });
  });

  describe('rule: a public host', () => {
    it('passes a public name, including one with a trailing dot', () => {
      expect(refusal('https://mcp.kumbu.example/mcp')).toBeNull();
      expect(refusal('https://example.com./mcp')).toBeNull();
      expect(refusal('https://local.example.com/mcp')).toBeNull();
    });

    it.each([
      'https://127.0.0.1/mcp',
      'https://8.8.8.8/mcp',
      'https://[::1]/mcp',
      'https://[2001:db8::1]/mcp',
      'https://0x7f.1/mcp',
      'https://2130706433/mcp',
      'https://127.0.0.1./mcp',
      'https://localhost/mcp',
      'https://LOCALHOST./mcp',
      'https://printer/mcp',
      'https://nas.local/mcp',
      'https://NAS.Local./mcp',
      'https://app.localhost/mcp',
      'https://x.internal/mcp',
      'https://router.lan/mcp',
      'https://x.home.arpa/mcp',
    ])('refuses %s', (raw) => {
      expect(refusal(raw)).toBe('not-public');
    });

    it('refuses a private host written without a scheme', () => {
      expect(refusal('localhost:3000/mcp')).toBe('not-public');
    });
  });

  describe('rule: at most 2,048 characters', () => {
    const prefix = 'https://example.com/';

    it('passes exactly 2,048 characters', () => {
      const raw = prefix + 'a'.repeat(2048 - prefix.length);
      expect(raw).toHaveLength(2048);
      expect(refusal(raw)).toBeNull();
    });

    it('refuses 2,049 characters', () => {
      const raw = prefix + 'a'.repeat(2049 - prefix.length);
      expect(raw).toHaveLength(2049);
      expect(refusal(raw)).toBe('too-long');
    });

    it('measures the normalised href, not the raw text', () => {
      // Each ü becomes six characters once percent-encoded.
      const raw = prefix + 'ü'.repeat(400);
      expect(raw.length).toBeLessThan(2048);
      expect(refusal(raw)).toBe('too-long');
    });
  });

  it('applies the rules in order: https before userinfo before fragment', () => {
    expect(refusal('http://user@localhost/#x')).toBe('not-https');
    expect(refusal('https://user@localhost/#x')).toBe('userinfo');
    expect(refusal('https://localhost/#x')).toBe('fragment');
    expect(refusal(`https://localhost/${'a'.repeat(3000)}`)).toBe('not-public');
  });
});

describe('linksInText', () => {
  it('finds an https link', () => {
    expect(linksInText('Add https://mcp.kumbu.example/mcp please')).toEqual([
      'https://mcp.kumbu.example/mcp',
    ]);
  });

  it('strips trailing punctuation', () => {
    expect(linksInText('Try https://mcp.kumbu.example/mcp.')).toEqual([
      'https://mcp.kumbu.example/mcp',
    ]);
    expect(linksInText('Is it https://a.example/mcp?!')).toEqual(['https://a.example/mcp']);
    expect(linksInText('"https://a.example/mcp",')).toEqual(['https://a.example/mcp']);
    expect(linksInText("'https://a.example/mcp';")).toEqual(['https://a.example/mcp']);
    expect(linksInText('<https://a.example/mcp>:')).toEqual(['https://a.example/mcp']);
  });

  it('strips a closing parenthesis or bracket', () => {
    expect(linksInText('(see https://a.example/mcp)')).toEqual(['https://a.example/mcp']);
    expect(linksInText('[https://a.example/mcp]')).toEqual(['https://a.example/mcp']);
    expect(linksInText('{https://a.example/mcp}.')).toEqual(['https://a.example/mcp']);
  });

  it('keeps a query in the link', () => {
    expect(linksInText('Use https://a.example/mcp?key=1&x=2.')).toEqual([
      'https://a.example/mcp?key=1&x=2',
    ]);
  });

  it('finds several links in order', () => {
    expect(
      linksInText('First https://a.example/mcp, then http://b.example/x and c.example/mcp.'),
    ).toEqual(['https://a.example/mcp', 'http://b.example/x', 'c.example/mcp']);
  });

  it('finds a bare host with a path', () => {
    expect(linksInText('The server is mcp.kumbu.example/mcp')).toEqual(['mcp.kumbu.example/mcp']);
  });

  it('finds an upper-case scheme', () => {
    expect(linksInText('HTTPS://A.example/mcp')).toEqual(['HTTPS://A.example/mcp']);
  });

  it('finds nothing in plain prose', () => {
    expect(linksInText('Nothing to see here. Really, e.g. nothing.')).toEqual([]);
  });

  it('does not take an e-mail-like text for a bare link', () => {
    expect(linksInText('mail me at me@mail.example/x')).toEqual([]);
  });
});

describe('userWroteLink', () => {
  const url = 'https://mcp.kumbu.example/mcp';

  it('is true when an earlier user text holds the link', () => {
    expect(userWroteLink(url, ['Add https://mcp.kumbu.example/mcp please', 'Thanks!'])).toBe(true);
  });

  it('is true for a link written without a scheme', () => {
    expect(userWroteLink(url, ['it is at mcp.kumbu.example/mcp'])).toBe(true);
  });

  it('ignores a trailing slash on either side', () => {
    expect(userWroteLink(url, ['https://mcp.kumbu.example/mcp/'])).toBe(true);
    expect(userWroteLink(`${url}/`, ['https://mcp.kumbu.example/mcp'])).toBe(true);
  });

  it('compares after normalisation', () => {
    expect(userWroteLink(url, ['HTTPS://MCP.Kumbu.Example/mcp'])).toBe(true);
    expect(userWroteLink('https://xn--bcher-kva.example/mcp', ['https://bücher.example/mcp'])).toBe(
      true,
    );
  });

  it('is false when the link is not in any user text', () => {
    expect(userWroteLink(url, ['Add the Kumbu server', 'https://other.example/mcp'])).toBe(false);
    expect(userWroteLink(url, [])).toBe(false);
  });

  it('is false when the user wrote a different path or query', () => {
    expect(userWroteLink(`${url}?c=secret`, ['https://mcp.kumbu.example/mcp'])).toBe(false);
    expect(userWroteLink(url, ['https://mcp.kumbu.example/mcp/v2'])).toBe(false);
  });

  it('is false when the user wrote only the http form', () => {
    expect(userWroteLink(url, ['http://mcp.kumbu.example/mcp'])).toBe(false);
  });
});

describe('emphasisSplit', () => {
  it('emphasises the last two labels', () => {
    expect(emphasisSplit('session-verify.evil.example')).toEqual({
      lead: 'session-verify.',
      tail: 'evil.example',
    });
    expect(emphasisSplit('mcp.kumbu.example')).toEqual({ lead: 'mcp.', tail: 'kumbu.example' });
  });

  it('emphasises the whole of a two-label host', () => {
    expect(emphasisSplit('example.com')).toEqual({ lead: '', tail: 'example.com' });
  });

  it('falls on the public suffix for a three-part country domain', () => {
    expect(emphasisSplit('example.co.uk')).toEqual({ lead: 'example.', tail: 'co.uk' });
  });

  it('emphasises a single-label host whole', () => {
    expect(emphasisSplit('printer')).toEqual({ lead: '', tail: 'printer' });
  });

  it('keeps a trailing dot with the tail', () => {
    expect(emphasisSplit('mcp.kumbu.example.')).toEqual({ lead: 'mcp.', tail: 'kumbu.example.' });
  });

  it('keeps lead and tail together equal to the host', () => {
    const host = 'a.b.c.d.example';
    const { lead, tail } = emphasisSplit(host);
    expect(lead + tail).toBe(host);
  });
});

describe('review fixes (T1 review, 2026-11-18)', () => {
  it('strips a long run of trailing punctuation in linear time', () => {
    const text = `https://a.example/${')'.repeat(100_000)}x`;
    const started = performance.now();
    userWroteLink('https://a.example/mcp', [text]);
    expect(performance.now() - started).toBeLessThan(100);
  });

  it.each([
    'https://localhost../mcp',
    'https://127.0.0.1../mcp',
    'https://nas.local../mcp',
    'https://printer../mcp',
    'https://a..b/mcp',
    'https://home.arpa/mcp',
    'https://0177.0.0.1/mcp',
    'https://[::ffff:127.0.0.1]/mcp',
  ])('refuses %s as not public', (raw) => {
    expect(normaliseConnectorLink(raw)).toEqual({ ok: false, reason: 'not-public' });
  });

  it('refuses port 0 as invalid', () => {
    expect(normaliseConnectorLink('https://example.com:0/mcp')).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  it.each([
    '`https://a.example/mcp`',
    '**https://a.example/mcp**',
    '“https://a.example/mcp”',
    '‘https://a.example/mcp’',
    '«https://a.example/mcp»',
    'https://a.example/mcp…',
    'see https://a.example/mcp.',
  ])('finds the user link wrapped as %s', (text) => {
    expect(userWroteLink('https://a.example/mcp', [text])).toBe(true);
  });

  it('keeps a closing bracket that closes one inside the link', () => {
    expect(linksInText('(see https://a.example/mcp_(foo))')).toEqual([
      'https://a.example/mcp_(foo)',
    ]);
  });

  it('ignores a trailing slash only on a link without a query', () => {
    expect(userWroteLink('https://a.example/mcp?x=/', ['https://a.example/mcp?x='])).toBe(false);
    expect(userWroteLink('https://a.example/mcp/', ['https://a.example/mcp'])).toBe(true);
  });

  it('accepts a bare host without a path, and with a port', () => {
    expect(userWroteLink('https://mcp.kumbu.example/', ['it is mcp.kumbu.example'])).toBe(true);
    expect(
      userWroteLink('https://mcp.kumbu.example:8443/mcp', ['mcp.kumbu.example:8443/mcp']),
    ).toBe(true);
  });
});
