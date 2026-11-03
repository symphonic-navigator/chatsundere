// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import type { McpOAuthGrantRow, McpServerRow } from '../../src/boot/client-data-db.js';
import { candidatesFor } from '../../src/mcp/mcp-connectivity.js';
import {
  canResolveOnFirstUse,
  resolveActiveServers,
  tokenAllowedFor,
  usableRoute,
} from '../../src/mcp/resolve-active.js';

const base = (over: Partial<McpServerRow>): McpServerRow => ({
  id: 's',
  name: 'S',
  url: 'https://s/mcp',
  prefix: 's',
  auth: null,
  onByDefault: true,
  autoRun: false,
  allowDirect: true,
  enabled: true,
  routing: 'direct',
  resolvedEndpoint: 'https://s/mcp',
  tools: [],
  hiddenTools: [],
  lastTestedAt: 1,
  lastError: null,
  createdAt: 1,
  updatedAt: 1,
  ...over,
});

describe('usableRoute', () => {
  it('accepts a route on the row origin, including the /mcp variant', () => {
    expect(
      usableRoute(base({ url: 'https://s', routing: 'proxy', resolvedEndpoint: 'https://s/mcp' })),
    ).toEqual({ routing: 'proxy', resolvedEndpoint: 'https://s/mcp' });
  });
  it('rejects a route pointing at any other origin', () => {
    expect(
      usableRoute(base({ url: 'https://new/mcp', resolvedEndpoint: 'https://old/mcp' })),
    ).toBeNull();
  });
  it('rejects a direct route when the row no longer allows direct', () => {
    expect(usableRoute(base({ allowDirect: false, routing: 'direct' }))).toBeNull();
  });
  it('rejects an unparsable endpoint rather than throwing', () => {
    expect(usableRoute(base({ resolvedEndpoint: 'not a url' }))).toBeNull();
  });
});

describe('resolveActiveServers', () => {
  it('default on, no override → active', () => {
    expect(
      resolveActiveServers([base({ id: 'a', onByDefault: true })], {}, true).map((s) => s.id),
    ).toEqual(['a']);
  });
  it('default off, override on → active', () => {
    expect(
      resolveActiveServers([base({ id: 'a', onByDefault: false })], { a: 'on' }, true).map(
        (s) => s.id,
      ),
    ).toEqual(['a']);
  });
  it('default on, override off → inactive', () => {
    expect(
      resolveActiveServers([base({ id: 'a', onByDefault: true })], { a: 'off' }, true),
    ).toEqual([]);
  });
  it('disabled server is never active', () => {
    expect(resolveActiveServers([base({ id: 'a', enabled: false })], { a: 'on' }, true)).toEqual(
      [],
    );
  });
  it('untested server (routing null) is never active', () => {
    expect(
      resolveActiveServers([base({ id: 'a', routing: null, resolvedEndpoint: null })], {}, true),
    ).toEqual([]);
  });
  it('proxy-routed server with no proxy configured is inactive', () => {
    expect(resolveActiveServers([base({ id: 'a', routing: 'proxy' })], {}, false)).toEqual([]);
  });

  describe('a row synced from another device (no local probe fields)', () => {
    const pulled = (over: Partial<McpServerRow> = {}): McpServerRow => {
      const {
        routing: _r,
        resolvedEndpoint: _e,
        ...rest
      } = base({
        id: 'a',
        allowDirect: false,
        tools: [{ name: 'go', description: '', inputSchema: {} }],
        ...over,
      });
      return rest as McpServerRow;
    };

    it('stays active: its synced tools prove a device has connected, the route resolves on first use', () => {
      expect(resolveActiveServers([pulled()], {}, true).map((s) => s.id)).toEqual(['a']);
    });
    it('is inactive when this device has no way to reach it', () => {
      expect(resolveActiveServers([pulled()], {}, false)).toEqual([]);
    });
    it('never probes a Local network server by itself, with or without a proxy', () => {
      expect(resolveActiveServers([pulled({ allowDirect: true })], {}, false)).toEqual([]);
      expect(resolveActiveServers([pulled({ allowDirect: true })], {}, true)).toEqual([]);
    });
  });
});

const grant = (over: Partial<McpOAuthGrantRow> = {}): McpOAuthGrantRow => ({
  id: 'o',
  resource: 'https://kumbu.example/mcp/c/abc',
  issuer: 'https://auth.example',
  tokenEndpoint: 'https://auth.example/token',
  revocationEndpoint: null,
  clientId: 'c',
  registration: 'cimd',
  scope: null,
  tokenRoute: 'proxy',
  tokens: null,
  claim: null,
  createdAt: 1,
  updatedAt: 1,
  ...over,
});
const oauthRow = (over: Partial<McpServerRow> = {}): McpServerRow =>
  base({
    id: 'o',
    url: 'https://kumbu.example/mcp/c/abc',
    auth: { scheme: 'oauth' },
    allowDirect: false,
    routing: 'proxy',
    resolvedEndpoint: 'https://kumbu.example/mcp/c/abc',
    tools: [{ name: 'go', description: '', inputSchema: {} }],
    ...over,
  });

describe('tokenAllowedFor (the token chokepoint)', () => {
  it('allows the grant resource, also in a non-canonical spelling', () => {
    expect(tokenAllowedFor(grant(), oauthRow())).toBe(true);
    expect(
      tokenAllowedFor(
        grant(),
        oauthRow({ url: 'https://KUMBU.example:443/mcp/c/abc/', resolvedEndpoint: null }),
      ),
    ).toBe(true);
  });
  it('refuses a differing origin', () => {
    expect(tokenAllowedFor(grant(), oauthRow({ url: 'https://evil.example/mcp/c/abc' }))).toBe(
      false,
    );
  });
  it('refuses a differing path', () => {
    expect(tokenAllowedFor(grant(), oauthRow({ url: 'https://kumbu.example/mcp' }))).toBe(false);
  });
  it('refuses a differing scheme', () => {
    expect(tokenAllowedFor(grant(), oauthRow({ url: 'http://kumbu.example/mcp/c/abc' }))).toBe(
      false,
    );
  });
  it('refuses when the resolved endpoint differs from the resource', () => {
    expect(
      tokenAllowedFor(
        grant(),
        oauthRow({ resolvedEndpoint: 'https://kumbu.example/mcp/c/abc/mcp' }),
      ),
    ).toBe(false);
  });
  it('refuses an unparsable URL rather than throwing', () => {
    expect(tokenAllowedFor(grant(), oauthRow({ url: 'nope' }))).toBe(false);
  });
});

describe('candidatesFor', () => {
  it('probes only the grant resource, never a /mcp variant', () => {
    const cs = candidatesFor(oauthRow({ allowDirect: true }), grant(), true);
    expect(cs).toEqual([
      { routing: 'direct', url: 'https://kumbu.example/mcp/c/abc' },
      { routing: 'proxy', url: 'https://kumbu.example/mcp/c/abc' },
    ]);
    expect(cs.some((c) => c.url.endsWith('/mcp'))).toBe(false);
  });
  it('is proxy-only without allowDirect', () => {
    expect(candidatesFor(oauthRow(), grant(), true)).toEqual([
      { routing: 'proxy', url: 'https://kumbu.example/mcp/c/abc' },
    ]);
  });
  it('yields nothing when the grant does not belong to the row', () => {
    expect(candidatesFor(oauthRow({ url: 'https://kumbu.example/other' }), grant(), true)).toEqual(
      [],
    );
  });
});

describe('canResolveOnFirstUse for OAuth rows', () => {
  it('resolves on first use with allowDirect, with or without a proxy', () => {
    expect(canResolveOnFirstUse(oauthRow({ allowDirect: true }), false)).toBe(true);
    expect(canResolveOnFirstUse(oauthRow({ allowDirect: true }), true)).toBe(true);
  });
  it('resolves on first use through the proxy', () => {
    expect(canResolveOnFirstUse(oauthRow({ allowDirect: false }), true)).toBe(true);
  });
  it('does not resolve with no route at all', () => {
    expect(canResolveOnFirstUse(oauthRow({ allowDirect: false }), false)).toBe(false);
  });
  it('key rows with allowDirect still do not', () => {
    const keyRow = oauthRow({
      allowDirect: true,
      auth: { scheme: 'bearer', key: {} as unknown as never },
    });
    expect(canResolveOnFirstUse(keyRow, true)).toBe(false);
    expect(canResolveOnFirstUse(keyRow, false)).toBe(false);
  });
});
