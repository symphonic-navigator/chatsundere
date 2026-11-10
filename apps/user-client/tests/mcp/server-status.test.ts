// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import type { McpOAuthGrantRow, McpServerRow } from '../../src/boot/client-data-db.js';
import { statusOf } from '../../src/mcp/server-status.js';

const ROW: McpServerRow = {
  id: 'o1',
  name: 'Kumbu',
  url: 'https://kumbu.example/mcp',
  prefix: 'kumbu',
  auth: { scheme: 'oauth' },
  onByDefault: true,
  autoRun: false,
  allowDirect: true,
  enabled: true,
  routing: 'direct',
  resolvedEndpoint: 'https://kumbu.example/mcp',
  tools: [],
  hiddenTools: [],
  lastTestedAt: null,
  lastError: null,
  firstUseConsentFor: null,
  createdAt: 1,
  updatedAt: 1,
};

const GRANT = {
  id: 'o1',
  resource: 'https://kumbu.example/mcp',
  issuer: 'https://auth.kumbu.example',
  tokenEndpoint: 'https://auth.kumbu.example/token',
  revocationEndpoint: null,
  clientId: 'c',
  registration: 'cimd',
  scope: null,
  tokenRoute: 'direct',
  redirectUri: 'https://app.example/oauth/callback',
  tokens: { v: 1 } as unknown,
  claim: null,
  createdAt: 1,
  updatedAt: 1,
} as McpOAuthGrantRow;

describe('statusOf for an OAuth row', () => {
  it('is connected direct when both the tools and the tokens go direct', () => {
    expect(statusOf(ROW, { hasProxy: false, linked: true, grant: GRANT })).toBe(
      '● Connected (direct)',
    );
  });

  it('waits for the proxy when the tokens are renewed through it, even on a direct route', () => {
    const grant = { ...GRANT, tokenRoute: 'proxy' } as McpOAuthGrantRow;
    expect(statusOf(ROW, { hasProxy: false, linked: true, grant })).toBe(
      '○ Waiting for your Chatsundere server',
    );
    expect(statusOf(ROW, { hasProxy: false, linked: false, grant })).toBe(
      '○ Needs a linked Chatsundere server',
    );
  });
});

describe('statusOf for a held OAuth grant', () => {
  const held = { ...GRANT, heldGeneration: 4, seenGeneration: 9 } as McpOAuthGrantRow;

  it('reads as paused here while it still has tokens', () => {
    expect(statusOf(ROW, { hasProxy: false, linked: true, grant: held })).toBe(
      '⚠ Sign-in paused here',
    );
  });

  it('reads as Sign in again when the held grant is also dead', () => {
    const grant = { ...held, tokens: null } as McpOAuthGrantRow;
    expect(statusOf(ROW, { hasProxy: false, linked: true, grant })).toBe('⚠ Sign in again');
  });

  it('a held grant with a new sign-in pending shows its normal status', () => {
    const grant = {
      ...held,
      pendingTokens: held.tokens,
      pendingNewFamily: true,
    } as McpOAuthGrantRow;
    expect(statusOf(ROW, { hasProxy: false, linked: true, grant })).toBe('● Connected (direct)');
  });

  it('ranks above waiting for the proxy', () => {
    const grant = { ...held, tokenRoute: 'proxy' } as McpOAuthGrantRow;
    expect(statusOf(ROW, { hasProxy: false, linked: true, grant })).toBe('⚠ Sign-in paused here');
  });
});
