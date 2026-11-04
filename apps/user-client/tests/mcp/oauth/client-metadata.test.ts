// SPDX-License-Identifier: AGPL-3.0-only
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildClientMetadata,
  clientMetadataUrl,
  isPubliclyFetchableOrigin,
  redirectUri,
} from '../../../src/mcp/oauth/client-metadata';

const read = (rel: string) => readFileSync(resolve(__dirname, '../../..', rel), 'utf-8');

describe('buildClientMetadata', () => {
  it('derives every URL from the origin, keeping a non-default port', () => {
    const m = buildClientMetadata('https://app.example:8443');
    expect(m.client_id).toBe('https://app.example:8443/oauth/client-metadata.json');
    expect(m.client_uri).toBe('https://app.example:8443');
    expect(m.redirect_uris).toEqual(['https://app.example:8443/oauth/callback']);
    expect(m.token_endpoint_auth_method).toBe('none');
    expect(m.grant_types).toEqual(['authorization_code', 'refresh_token']);
    expect(m.response_types).toEqual(['code']);
    expect(m.client_name).toBe('Chatsundere');
  });

  it('exposes the two URL helpers', () => {
    expect(clientMetadataUrl('https://a.example')).toBe(
      'https://a.example/oauth/client-metadata.json',
    );
    expect(redirectUri('https://a.example')).toBe('https://a.example/oauth/callback');
  });
});

describe('isPubliclyFetchableOrigin', () => {
  it.each([
    'http://localhost:3000',
    'https://127.0.0.1',
    'https://[::1]',
    'https://192.168.1.2',
    'https://10.0.0.5',
    'https://172.20.1.1',
    'https://box.local',
    'https://localhost.',
    'https://box.local.',
    'https://[::ffff:192.168.1.2]',
    'https://[::ffff:7f00:1]',
    'https://100.64.0.1',
    'https://100.127.255.1',
    'https://nas.internal',
    'https://printer.lan',
    'https://router.home.arpa',
    'https://[fd12:3456::1]',
    'https://[fe80::1]',
  ])('refuses %s', (origin) => {
    expect(isPubliclyFetchableOrigin(origin)).toBe(false);
  });

  it('accepts a public https origin, with or without a port', () => {
    expect(isPubliclyFetchableOrigin('https://app.example')).toBe(true);
    expect(isPubliclyFetchableOrigin('https://app.example:8443')).toBe(true);
    expect(isPubliclyFetchableOrigin('https://172.32.0.1')).toBe(true);
    expect(isPubliclyFetchableOrigin('https://100.128.0.1')).toBe(true);
    expect(isPubliclyFetchableOrigin('https://app.example.')).toBe(true);
    expect(isPubliclyFetchableOrigin('https://[::ffff:8.8.8.8]')).toBe(true);
  });

  it('refuses garbage', () => {
    expect(isPubliclyFetchableOrigin('not a url')).toBe(false);
  });
});

describe('deployment files', () => {
  it('nginx serves the metadata document behind a strict host check', () => {
    const conf = read('nginx.conf');
    expect(conf).toContain('location = /oauth/client-metadata.json');
    expect(conf).toContain('^[A-Za-z0-9.-]+(:[0-9]+)?$');
    expect(conf).toContain('return 400');
    expect(conf).toContain('"client_id": "https://${http_host}/oauth/client-metadata.json"');
  });

  it('nginx callback location is unlogged, unreferred and keeps the isolation headers', () => {
    const conf = read('nginx.conf');
    const start = conf.indexOf('location = /oauth/callback');
    expect(start).toBeGreaterThan(-1);
    const block = conf.slice(start, conf.indexOf('}', start));
    expect(block).toContain('access_log off');
    expect(block).toContain('Referrer-Policy "no-referrer"');
    expect(block).toContain('Cache-Control "no-store"');
    expect(block).toContain('Cross-Origin-Opener-Policy');
    expect(block).toContain('Cross-Origin-Embedder-Policy');
    expect(block).toContain('Cross-Origin-Resource-Policy');
    expect(block).toContain('/oauth-callback.html');
  });

  it('the metadata location repeats the isolation headers', () => {
    const conf = read('nginx.conf');
    const start = conf.indexOf('location = /oauth/client-metadata.json');
    const block = conf.slice(start, conf.indexOf('\n    }', start));
    expect(block).toContain('Cross-Origin-Opener-Policy');
    expect(block).toContain('Cross-Origin-Embedder-Policy');
    expect(block).toContain('Cross-Origin-Resource-Policy');
    expect(block).toContain('add_header Vary "Host"');
  });

  it('the service worker never answers /oauth/ from the cached shell', () => {
    expect(read('vite.config.ts')).toMatch(
      /navigateFallbackDenylist:\s*\[[^\]]*\/\^\\\/oauth\\\/\//,
    );
  });
});
