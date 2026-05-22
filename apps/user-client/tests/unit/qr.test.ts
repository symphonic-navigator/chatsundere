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

  it('rejects non-loopback http://', () => {
    const result = parseJoinUrl('http://chatsundere.me/join#AB7K3-MN9PN');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('bad_scheme');
  });

  it('rejects URLs without /join segment', () => {
    expect(parseJoinUrl('https://chatsundere.me/').ok).toBe(false);
    expect(parseJoinUrl('https://chatsundere.me/login').ok).toBe(false);
  });

  it('rejects out-of-alphabet fragment chars', () => {
    expect(parseJoinUrl('https://chatsundere.me/join#IB7K3-MN9PN').ok).toBe(false);
    expect(parseJoinUrl('https://chatsundere.me/join#VB7K3-MN9PN').ok).toBe(false);
  });

  it('rejects entirely malformed strings', () => {
    expect(parseJoinUrl('not a url').ok).toBe(false);
  });
});
