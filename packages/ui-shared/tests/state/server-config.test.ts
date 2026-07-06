// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { parseServerConfig } from '../../src/state/server-config.js';

describe('parseServerConfig', () => {
  it('accepts a minimal valid config', () => {
    expect(parseServerConfig({ features: [] })).toEqual({ features: [] });
  });

  it('accepts https URLs and preserves unknown feature strings', () => {
    const input = {
      proxyUrl: 'https://proxy.chatsundere.me',
      syncUrl: 'https://sync.chatsundere.me',
      features: ['proxy', 'sync', 'blobs', 'espresso-machine'],
    };
    expect(parseServerConfig(input)).toEqual(input);
  });

  it('tolerates unknown top-level keys (forward compatibility)', () => {
    const parsed = parseServerConfig({ features: ['proxy'], banner: 'hi' });
    expect(parsed).not.toBeNull();
    expect(parsed?.features).toEqual(['proxy']);
  });

  it('accepts http only for localhost hosts', () => {
    expect(parseServerConfig({ proxyUrl: 'http://localhost:3300', features: [] })).not.toBeNull();
    expect(parseServerConfig({ proxyUrl: 'http://127.0.0.1:3300', features: [] })).not.toBeNull();
    expect(parseServerConfig({ proxyUrl: 'http://proxy.chatsundere.me', features: [] })).toBeNull();
  });

  it('rejects a present-but-malformed URL (whole response invalid)', () => {
    expect(parseServerConfig({ proxyUrl: 'not a url', features: [] })).toBeNull();
  });

  it('rejects missing or malformed features', () => {
    expect(parseServerConfig({})).toBeNull();
    expect(parseServerConfig({ features: 'proxy' })).toBeNull();
    expect(parseServerConfig({ features: [42] })).toBeNull();
    expect(parseServerConfig(null)).toBeNull();
    expect(parseServerConfig('nonsense')).toBeNull();
  });

  it('accepts and preserves a valid adminUrl', () => {
    const input = { adminUrl: 'https://admin.chatsundere.me', features: ['admin'] };
    expect(parseServerConfig(input)).toEqual(input);
  });

  it('accepts http adminUrl only for loopback', () => {
    expect(parseServerConfig({ adminUrl: 'http://localhost:5174', features: [] })).not.toBeNull();
    expect(parseServerConfig({ adminUrl: 'http://admin.chatsundere.me', features: [] })).toBeNull();
  });

  it('rejects a present-but-malformed adminUrl (whole response invalid)', () => {
    expect(parseServerConfig({ adminUrl: 'not a url', features: [] })).toBeNull();
  });

  it('tolerates a missing adminUrl', () => {
    const parsed = parseServerConfig({ proxyUrl: 'https://proxy.example', features: ['proxy'] });
    expect(parsed).not.toBeNull();
    expect(parsed?.adminUrl).toBeUndefined();
  });
});
