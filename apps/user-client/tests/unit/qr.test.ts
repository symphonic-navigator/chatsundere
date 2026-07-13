// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { parseJoinUrl } from '../../src/lib/qr.js';

describe('parseJoinUrl', () => {
  it('accepts the canonical https://host/join#CODE form', () => {
    const result = parseJoinUrl('https://chatsundere.me/join#AB7K3-MN9PN');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.baseUrl).toBe('https://chatsundere.me/');
      expect(result.value.code).toBe('AB7K3-MN9PN');
    }
  });

  it('accepts http://localhost:N/join#CODE', () => {
    const result = parseJoinUrl('http://localhost:3100/join#AB7K3-MN9PN');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.baseUrl).toBe('http://localhost:3100/');
  });

  it('accepts sub-path-hosted base URLs (ADR 0023 relaxation)', () => {
    const result = parseJoinUrl('https://relay.example.com/t4524089/join#AB7K3-MN9PN');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.baseUrl).toBe('https://relay.example.com/t4524089/');
  });

  it('reads a well-formed suggested username from the u param (client-origin form)', () => {
    const result = parseJoinUrl(
      'https://app.example.com/join?server=https%3A%2F%2Fauth.example.com&u=alice#AB7K3-MN9PN',
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.baseUrl).toBe('https://auth.example.com');
      expect(result.value.code).toBe('AB7K3-MN9PN');
      expect(result.value.suggestedUsername).toBe('alice');
    }
  });

  it('reads a suggested username from the legacy form too', () => {
    const result = parseJoinUrl('https://chatsundere.me/join?u=bob_23#AB7K3-MN9PN');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.suggestedUsername).toBe('bob_23');
  });

  it('drops a malformed suggested username rather than failing the parse', () => {
    // Uppercase / leading digit / too-long all violate the username rule; the
    // join must still succeed, just without a pre-fill.
    for (const bad of ['Alice', '9nine', 'a', 'has space', 'x'.repeat(40)]) {
      const result = parseJoinUrl(
        `https://chatsundere.me/join?u=${encodeURIComponent(bad)}#AB7K3-MN9PN`,
      );
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.suggestedUsername).toBeUndefined();
    }
  });

  it('leaves suggestedUsername undefined when no u param is present', () => {
    const result = parseJoinUrl('https://chatsundere.me/join#AB7K3-MN9PN');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.suggestedUsername).toBeUndefined();
  });

  it('rejects non-loopback http://', () => {
    const result = parseJoinUrl('http://chatsundere.me/join#AB7K3-MN9PN');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('bad_scheme');
  });

  it('rejects URLs without /join segment', () => {
    expect(parseJoinUrl('https://chatsundere.me/').ok).toBe(false);
    expect(parseJoinUrl('https://chatsundere.me/login').ok).toBe(false);
  });

  it('normalises confusable fragment chars (I/V) before validating, same as manual entry', () => {
    // I and V are confusable-character substitution targets (→ 1 / Y) in
    // normaliseCodeInput, so a fragment carrying them now auto-corrects
    // rather than being rejected outright.
    const r1 = parseJoinUrl('https://chatsundere.me/join#IB7K3-MN9PN');
    expect(r1).toEqual({
      ok: true,
      value: { baseUrl: 'https://chatsundere.me/', code: '1B7K3-MN9PN' },
    });
    const r2 = parseJoinUrl('https://chatsundere.me/join#VB7K3-MN9PN');
    expect(r2).toEqual({
      ok: true,
      value: { baseUrl: 'https://chatsundere.me/', code: 'YB7K3-MN9PN' },
    });
  });

  it('rejects a fragment that is still malformed after normalisation', () => {
    // Too few alphabet characters to reach the canonical 10-char shape even
    // once normalised.
    expect(parseJoinUrl('https://chatsundere.me/join#AB7-MN9').ok).toBe(false);
  });

  it('normalises a lowercase legacy join-URL paste to the canonical uppercase code', () => {
    const result = parseJoinUrl('https://chatsundere.me/join#ab7k3-mn9pn');
    expect(result).toEqual({
      ok: true,
      value: { baseUrl: 'https://chatsundere.me/', code: 'AB7K3-MN9PN' },
    });
  });

  it('rejects entirely malformed strings', () => {
    expect(parseJoinUrl('not a url').ok).toBe(false);
  });

  it('new client-origin form: server param wins, code from fragment', () => {
    const r = parseJoinUrl(
      'https://app.example.com/join?server=https%3A%2F%2Fauth.example.com#AB7K3-MN9PN',
    );
    expect(r).toEqual({
      ok: true,
      value: { baseUrl: 'https://auth.example.com', code: 'AB7K3-MN9PN' },
    });
  });

  it('new form: decoded server must be https (or loopback http) — else bad_server_param', () => {
    const r = parseJoinUrl(
      'https://app.example.com/join?server=http%3A%2F%2Fevil.example.com#AB7K3-MN9PN',
    );
    expect(r).toEqual({ ok: false, error: 'bad_server_param' });
  });

  it('new form: loopback-http server accepted (dev)', () => {
    const r = parseJoinUrl(
      'https://app.example.com/join?server=http%3A%2F%2Flocalhost%3A8080#AB7K3-MN9PN',
    );
    expect(r.ok).toBe(true);
  });

  it('legacy form still parses byte-identically', () => {
    const r = parseJoinUrl('https://auth.example.com/join#AB7K3-MN9PN');
    expect(r).toEqual({
      ok: true,
      value: { baseUrl: 'https://auth.example.com/', code: 'AB7K3-MN9PN' },
    });
  });
});
