// SPDX-License-Identifier: LGPL-3.0-only

import { describe, expect, it } from 'bun:test';
import { probeProvider } from './probe.js';
import type { ProviderConfig, ProviderDefinition } from './types.js';

function asMockFetch(
  impl: (input: string | Request | URL, init?: RequestInit) => Promise<Response>,
): typeof fetch {
  return Object.assign(impl, { preconnect: async () => {} }) as unknown as typeof fetch;
}

const novitaDef: ProviderDefinition = {
  id: 'novita',
  displayName: 'Novita AI',
  iconKey: 'novita',
  baseUrl: 'https://api.novita.ai/v3/openai',
  shape: 'openai-chat-completions',
  capabilities: ['llm', 'streaming'],
  configFields: [],
  probe: { path: '/models', method: 'GET' },
  secretFields: new Set(['api_key']),
  corsHint: 'direct',
  offerings: [],
  sortPriority: 20,
};

const novitaCfg: ProviderConfig = {
  baseUrl: novitaDef.baseUrl,
  routing: { kind: 'direct' },
};

describe('probeProvider', () => {
  it('returns ok=true with modelCount when upstream returns a model list', async () => {
    const fetchFn = asMockFetch(
      async () =>
        new Response(JSON.stringify({ data: [{ id: 'glm-5.1' }, { id: 'extra' }] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    );
    const result = await probeProvider({
      definition: novitaDef,
      config: novitaCfg,
      apiKey: 'k',
      fetchFn,
    });
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.modelCount).toBe(2);
  });

  it('returns ok=true with modelCount=undefined for non-model-list 200s', async () => {
    const fetchFn = asMockFetch(
      async () =>
        new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }),
    );
    const result = await probeProvider({
      definition: novitaDef,
      config: novitaCfg,
      apiKey: 'k',
      fetchFn,
    });
    expect(result.ok).toBe(true);
    expect(result.modelCount).toBeUndefined();
  });

  it('returns ok=false with reason on 401', async () => {
    const fetchFn = asMockFetch(async () => new Response('unauthorized', { status: 401 }));
    const result = await probeProvider({
      definition: novitaDef,
      config: novitaCfg,
      apiKey: 'wrong',
      fetchFn,
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(401);
    expect(result.reason).toMatch(/unauthor/i);
  });

  it('returns ok=false on network error', async () => {
    const fetchFn = asMockFetch(async () => {
      throw new TypeError('Failed to fetch');
    });
    const result = await probeProvider({
      definition: novitaDef,
      config: novitaCfg,
      apiKey: 'k',
      fetchFn,
    });
    expect(result.ok).toBe(false);
    expect(result.status).toBe(0);
    expect(result.reason).toMatch(/Failed to fetch/);
  });
});

describe('probeProvider auth scheme and body shapes', () => {
  it("probeProvider sends the definition's auth scheme", async () => {
    let captured: Request | undefined;
    const fetchFn = asMockFetch(async (input) => {
      captured = input as Request;
      return new Response('[]', { status: 200 });
    });
    await probeProvider({
      definition: { ...novitaDef, auth: { header: 'xi-api-key' } },
      config: novitaCfg,
      apiKey: 'k',
      fetchFn,
    });
    expect(captured?.headers.get('xi-api-key')).toBe('k');
    expect(captured?.headers.get('authorization')).toBeNull();
  });

  it('probeProvider reports ok with no model count for a bare-array body', async () => {
    const fetchFn = asMockFetch(
      async () => new Response(JSON.stringify([{ model_id: 'eleven_v4' }]), { status: 200 }),
    );
    const result = await probeProvider({
      definition: novitaDef,
      config: novitaCfg,
      apiKey: 'k',
      fetchFn,
    });
    expect(result.ok).toBe(true);
    expect(result.modelCount).toBeUndefined();
  });
});
