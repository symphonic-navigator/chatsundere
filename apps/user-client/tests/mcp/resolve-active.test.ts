// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import type { McpServerRow } from '../../src/boot/client-data-db.js';
import { resolveActiveServers, usableRoute } from '../../src/mcp/resolve-active.js';

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
