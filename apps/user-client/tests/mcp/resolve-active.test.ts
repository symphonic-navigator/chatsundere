// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import type { McpServerRow } from '../../src/boot/client-data-db.js';
import { resolveActiveServers } from '../../src/mcp/resolve-active.js';

const base = (over: Partial<McpServerRow>): McpServerRow => ({
  id: 's',
  name: 'S',
  url: 'https://s/mcp',
  prefix: 's',
  auth: null,
  onByDefault: true,
  autoRun: false,
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
});
