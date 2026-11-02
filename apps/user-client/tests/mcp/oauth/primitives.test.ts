// SPDX-License-Identifier: AGPL-3.0-only
import { toBase64Url } from '@chatsundere/crypto';
import { describe, expect, it } from 'vitest';
import {
  decodeCallbackPayload,
  encodeCallbackPayload,
} from '../../../src/mcp/oauth/callback-payload.js';
import { createPkce, randomState, s256Challenge } from '../../../src/mcp/oauth/pkce.js';
import { OAuthError, assertSecureEndpoint, canonicalResource } from '../../../src/mcp/oauth/url.js';
import { parseBearerChallenge } from '../../../src/mcp/oauth/www-authenticate.js';

describe('canonicalResource', () => {
  it('lowercases scheme and host, drops default port and one trailing slash', () => {
    expect(canonicalResource('HTTPS://Kumbu.Example:443/mcp/c/abc/')).toBe(
      'https://kumbu.example/mcp/c/abc',
    );
  });
  it('keeps path case exactly', () => {
    expect(canonicalResource('https://kumbu.example/mcp/C/abc')).toBe(
      'https://kumbu.example/mcp/C/abc',
    );
  });
  it('keeps non-default ports, drops fragments and the bare-root slash', () => {
    expect(canonicalResource('https://kumbu.example:8443/mcp#frag')).toBe(
      'https://kumbu.example:8443/mcp',
    );
    expect(canonicalResource('https://kumbu.example/')).toBe('https://kumbu.example');
    expect(canonicalResource('http://kumbu.example:80/x')).toBe('http://kumbu.example/x');
  });
  it('drops only one trailing slash', () => {
    expect(canonicalResource('https://kumbu.example/a//')).toBe('https://kumbu.example/a/');
  });
  it('converts an IDN host to punycode and keeps percent-encoding as given', () => {
    expect(canonicalResource('https://Bücher.example/mcp')).toBe(
      'https://xn--bcher-kva.example/mcp',
    );
    expect(canonicalResource('https://kumbu.example/a%2Fb/%7Euser')).toBe(
      'https://kumbu.example/a%2Fb/%7Euser',
    );
  });
  it('keeps the query and drops the fragment', () => {
    expect(canonicalResource('https://kumbu.example/mcp?x=1&y=%20#top')).toBe(
      'https://kumbu.example/mcp?x=1&y=%20',
    );
  });
  it('rejects userinfo and non-http schemes without echoing the input', () => {
    for (const bad of [
      'https://user:pw-secret@kumbu.example/mcp',
      'https://user@kumbu.example/mcp',
      'ftp://kumbu.example/mcp',
      'javascript:alert(1)',
    ]) {
      try {
        canonicalResource(bad);
        expect.unreachable();
      } catch (e) {
        expect(e).toBeInstanceOf(OAuthError);
        expect((e as OAuthError).kind).toBe('bad-metadata');
        expect((e as OAuthError).message).not.toContain('secret');
      }
    }
  });
  it('throws OAuthError on an invalid URL', () => {
    expect(() => canonicalResource('not a url')).toThrow(OAuthError);
  });
});

describe('assertSecureEndpoint', () => {
  it('refuses plain http and non-http schemes', () => {
    expect(() => assertSecureEndpoint('http://kumbu.example/t', 'token')).toThrow(OAuthError);
    expect(() => assertSecureEndpoint('javascript:alert(1)', 'authorize')).toThrow(OAuthError);
    expect(() => assertSecureEndpoint('data:text/html,x', 'authorize')).toThrow(OAuthError);
    expect(() => assertSecureEndpoint('nonsense', 'authorize')).toThrow(OAuthError);
  });
  it('rejects userinfo', () => {
    expect(() => assertSecureEndpoint('https://u:p@kumbu.example/t', 'token')).toThrow(OAuthError);
  });
  it('accepts https', () => {
    expect(() => assertSecureEndpoint('https://kumbu.example/t', 'token')).not.toThrow();
  });
  it('accepts loopback http only in development', () => {
    const run = () => assertSecureEndpoint('http://127.0.0.1:8080/t', 'token');
    if (import.meta.env.DEV) expect(run).not.toThrow();
    else expect(run).toThrow(OAuthError);
  });
  it('carries kind not-secure and names the label', () => {
    try {
      assertSecureEndpoint('http://kumbu.example/t', 'token');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(OAuthError);
      expect((e as OAuthError).kind).toBe('not-secure');
      expect((e as OAuthError).message).toContain('token');
    }
  });
});

describe('pkce', () => {
  it('matches the RFC 7636 appendix B vector', async () => {
    expect(await s256Challenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    );
  });
  it('creates a verifier of 43+ unreserved characters whose challenge is S256 of it', async () => {
    const { verifier, challenge } = await createPkce();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(challenge).toBe(await s256Challenge(verifier));
    expect(challenge).not.toBe(verifier);
  });
  it('is random per call', async () => {
    expect((await createPkce()).verifier).not.toBe((await createPkce()).verifier);
  });
  it('randomState is 256 bits of base64url', () => {
    const s = randomState();
    expect(s).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomState()).not.toBe(s);
  });
});

describe('parseBearerChallenge', () => {
  it('parses a Bearer challenge after another scheme, with commas in quoted strings', () => {
    expect(
      parseBearerChallenge(
        'Basic realm="x", Bearer resource_metadata="https://a/b, c", scope="a b"',
      ),
    ).toEqual({ resourceMetadata: 'https://a/b, c', scope: 'a b' });
  });
  it('returns null without a Bearer challenge', () => {
    expect(parseBearerChallenge('Basic realm="x"')).toBeNull();
    expect(parseBearerChallenge('')).toBeNull();
  });
  it('is case-insensitive on scheme and parameter names', () => {
    expect(
      parseBearerChallenge(
        'bEaReR Resource_Metadata="https://a/m", SCOPE=read, ERROR=invalid_token',
      ),
    ).toEqual({ resourceMetadata: 'https://a/m', scope: 'read', error: 'invalid_token' });
  });
  it('handles a bare Bearer with no parameters', () => {
    expect(parseBearerChallenge('Bearer')).toEqual({});
  });
  it('handles escaped quotes in quoted strings', () => {
    expect(parseBearerChallenge('Bearer scope="a \\"b\\" c", error="x"')).toEqual({
      scope: 'a "b" c',
      error: 'x',
    });
  });
  it("does not attribute another scheme's parameters to Bearer", () => {
    expect(
      parseBearerChallenge('Bearer error="invalid_token", Digest realm="r", scope="nope"'),
    ).toEqual({ error: 'invalid_token' });
  });
  it('skips token68 forms of other schemes', () => {
    expect(parseBearerChallenge('Negotiate abc123==, Bearer scope="s"')).toEqual({ scope: 's' });
    expect(parseBearerChallenge('Negotiate abc123==')).toBeNull();
  });
  it('ignores unknown parameters and tolerates odd whitespace', () => {
    expect(parseBearerChallenge('  Bearer   realm = "r" ,  scope="s"  ')).toEqual({ scope: 's' });
  });
  it('records an empty parameter value instead of starting a new challenge', () => {
    expect(parseBearerChallenge('Bearer error=, scope="x"')).toEqual({ error: '', scope: 'x' });
    expect(parseBearerChallenge('Bearer scope="x", error=')).toEqual({ scope: 'x', error: '' });
  });
  it('consumes unquoted values with non-token characters', () => {
    expect(parseBearerChallenge('Bearer scope=a/b, error=invalid_token')).toEqual({
      scope: 'a/b',
      error: 'invalid_token',
    });
    expect(parseBearerChallenge('Bearer scope=a/b error=x')?.scope).toBe('a/b');
  });
  it('drops a parameter whose quoted-string is unterminated', () => {
    expect(parseBearerChallenge('Bearer error="invalid_token", scope="oops')).toEqual({
      error: 'invalid_token',
    });
  });
  it('finds Bearer when it is not first, with a following scheme', () => {
    expect(parseBearerChallenge('Basic realm="x", Bearer scope="s", Basic realm="y"')).toEqual({
      scope: 's',
    });
  });
});

describe('callback payload', () => {
  it('round-trips a code payload', () => {
    const p = { code: 'c', state: 's', iss: 'i' };
    const s = encodeCallbackPayload(p);
    expect(s.startsWith('csm1.')).toBe(true);
    expect(decodeCallbackPayload(s)).toEqual(p);
  });
  it('round-trips without iss and error payloads, including non-ASCII', () => {
    expect(decodeCallbackPayload(encodeCallbackPayload({ code: 'ü€', state: 's' }))).toEqual({
      code: 'ü€',
      state: 's',
    });
    expect(
      decodeCallbackPayload(encodeCallbackPayload({ error: 'access_denied', state: 's' })),
    ).toEqual({
      error: 'access_denied',
      state: 's',
    });
  });
  it('trims whitespace', () => {
    const s = encodeCallbackPayload({ code: 'c', state: 's' });
    expect(decodeCallbackPayload(`  \n${s}\t `)).toEqual({ code: 'c', state: 's' });
  });
  it('rejects garbage and a missing prefix', () => {
    expect(decodeCallbackPayload('not-a-code')).toBeNull();
    expect(decodeCallbackPayload('')).toBeNull();
    expect(decodeCallbackPayload('csm1.')).toBeNull();
    expect(decodeCallbackPayload('csm1.!!!not-base64!!!')).toBeNull();
    const body = encodeCallbackPayload({ code: 'c', state: 's' }).slice('csm1.'.length);
    expect(decodeCallbackPayload(body)).toBeNull();
    expect(decodeCallbackPayload(`csm2.${body}`)).toBeNull();
  });
  const enc = (v: unknown) => `csm1.${toBase64Url(new TextEncoder().encode(JSON.stringify(v)))}`;
  it('validates shape strictly and never throws', () => {
    expect(decodeCallbackPayload(enc(null))).toBeNull();
    expect(decodeCallbackPayload(enc([]))).toBeNull();
    expect(decodeCallbackPayload(enc('str'))).toBeNull();
    expect(decodeCallbackPayload(enc({ code: 'c' }))).toBeNull();
    expect(decodeCallbackPayload(enc({ state: 's' }))).toBeNull();
    expect(decodeCallbackPayload(enc({ code: 1, state: 's' }))).toBeNull();
    expect(decodeCallbackPayload(enc({ code: 'c', state: 's', iss: 5 }))).toBeNull();
    expect(decodeCallbackPayload(enc({ error: 'e' }))).toBeNull();
    expect(decodeCallbackPayload(enc({ error: 3, state: 's' }))).toBeNull();
    expect(decodeCallbackPayload(enc({ code: 'c', error: 'e', state: 's' }))).toBeNull();
    expect(decodeCallbackPayload(enc({ code: '', state: 's' }))).toBeNull();
    expect(
      decodeCallbackPayload(`csm1.${toBase64Url(new TextEncoder().encode('{bad'))}`),
    ).toBeNull();
  });
  it('drops unknown fields from the result', () => {
    expect(decodeCallbackPayload(enc({ code: 'c', state: 's', extra: 'x' }))).toEqual({
      code: 'c',
      state: 's',
    });
  });
});
