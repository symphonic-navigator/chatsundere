// SPDX-License-Identifier: MIT

import { describe, expect, it } from 'bun:test';
import { opaqueServerIdentity } from '../src/opaque-identity.js';

describe('opaqueServerIdentity', () => {
  it('derives an origin-based identity, dropping any path', () => {
    expect(opaqueServerIdentity('http://localhost:3100')).toBe('http://localhost:3100/v1');
    expect(opaqueServerIdentity('https://chatsundere.example.com')).toBe(
      'https://chatsundere.example.com/v1',
    );
  });

  it('ignores a trailing slash', () => {
    expect(opaqueServerIdentity('http://localhost:3100/')).toBe('http://localhost:3100/v1');
  });

  it('drops a reverse-proxy path prefix so dev and prod agree', () => {
    // The regression this guards: the client derives the identity from the
    // linked account's base_url, the server from API_BASE_URL. Those two URLs
    // may carry different paths across topologies (dev: direct port; prod:
    // behind /auth), but must yield the identical OPAQUE `server` string.
    expect(opaqueServerIdentity('https://host/auth')).toBe('https://host/v1');
    expect(opaqueServerIdentity('https://host')).toBe('https://host/v1');
  });

  it('agrees between a client base_url and the matching server API_BASE_URL (dev)', () => {
    const clientBaseUrl = 'http://localhost:3100/'; // parsed from the join QR
    const serverApiBaseUrl = 'http://localhost:3100'; // auth-service API_BASE_URL
    expect(opaqueServerIdentity(clientBaseUrl)).toBe(opaqueServerIdentity(serverApiBaseUrl));
  });
});
