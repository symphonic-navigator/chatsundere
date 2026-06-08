// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { applyPrefix, buildMcpToolNames, sanitiseToolName } from '../../src/mcp/tool-naming.js';

describe('sanitiseToolName', () => {
  it('keeps allowed chars, replaces the rest with underscore', () => {
    expect(sanitiseToolName('create.issue/now')).toBe('create_issue_now');
    expect(sanitiseToolName('Search Web!')).toBe('Search_Web_');
  });
  it('clips to 64 chars', () => {
    expect(sanitiseToolName('a'.repeat(80))).toHaveLength(64);
  });
});

describe('applyPrefix', () => {
  it('joins prefix and name, sanitised and clipped', () => {
    expect(applyPrefix('github', 'create_issue')).toBe('github_create_issue');
    expect(applyPrefix('weird srv', 'do.thing')).toBe('weird_srv_do_thing');
  });
});

describe('buildMcpToolNames', () => {
  const githubServer = {
    id: 's1',
    prefix: 'github',
    tools: [{ name: 'search' }, { name: 'create_issue' }],
  };
  const servers = [
    githubServer,
    { id: 's2', prefix: 'github', tools: [{ name: 'search' }] }, // prefix collision
  ];

  it('produces unique wire names and a reverse map', () => {
    const { tools, reverse } = buildMcpToolNames(servers);
    const names = tools.map((t) => t.wireName);
    expect(new Set(names).size).toBe(names.length); // all unique
    for (const t of tools) {
      expect(reverse.get(t.wireName)).toEqual({
        serverId: t.serverId,
        originalName: t.originalName,
      });
    }
  });

  it('keeps a non-colliding name stable (no discriminator)', () => {
    const { tools } = buildMcpToolNames([githubServer]);
    expect(tools.find((t) => t.originalName === 'search')?.wireName).toBe('github_search');
  });

  it('wire names stay ≤ 64 chars and unique even when discriminator reaches ≥ 100', () => {
    // 110 servers all exposing a tool with the same name produces discriminators up to _110,
    // whose suffix is 4 chars — the old static MAX_NAME-3 reservation would overflow to 65.
    const manyServers = Array.from({ length: 110 }, (_, i) => ({
      id: `s${i}`,
      prefix: 'x',
      tools: [{ name: 'tool' }],
    }));
    const { tools } = buildMcpToolNames(manyServers);
    const wireNames = tools.map((t) => t.wireName);
    for (const wn of wireNames) {
      expect(wn.length, `"${wn}" exceeds 64 chars`).toBeLessThanOrEqual(64);
    }
    expect(new Set(wireNames).size).toBe(wireNames.length); // all unique
  });
});
