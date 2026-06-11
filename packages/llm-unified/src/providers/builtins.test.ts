// SPDX-License-Identifier: LGPL-3.0-only

import { beforeAll, describe, expect, it } from 'bun:test';
import { _resetAdapterRegistryForTests } from '../adapter-registry.js';
import { effectiveFreedom, getCanonical } from '../catalogue/index.js';
import { _resetRegistryForTests, getProvider, listProviders } from '../registry.js';
import { registerBuiltinProviders } from './_register-builtins.js';

beforeAll(() => {
  // Reset both registries: registerBuiltinProviders also registers catalogue
  // adapters, which throw on duplicate ids if a prior test file registered
  // builtins without clearing them. Resetting here keeps this file order-independent.
  _resetRegistryForTests();
  _resetAdapterRegistryForTests();
  registerBuiltinProviders();
});

describe('built-in providers', () => {
  it('registers all nine built-ins in sortPriority order', () => {
    const ids = listProviders().map((p) => p.id);
    expect(ids).toEqual([
      'chutes',
      'tensorix',
      'mistral',
      'wafer',
      'novita',
      'xai',
      'ollama-cloud',
      'nano-gpt',
      'openrouter',
    ]);
  });

  it('nano-gpt has inofficial CORS hint and openai-chat-completions shape', () => {
    const p = getProvider('nano-gpt');
    expect(p).toBeDefined();
    if (p) {
      expect(p.corsHint).toBe('inofficial');
      // 6 original + 3 Mistral (small-4, medium-3.5, large-3) + 8 Claude + 4 web + 3 tti = 24.
      expect(p.offerings).toHaveLength(24);
      expect(p.shape).toBe('openai-chat-completions');
    }
  });

  it('mistral has direct CORS hint, four offerings (3 LLM + 1 TTS), and sortPriority 14', () => {
    const p = getProvider('mistral');
    expect(p).toBeDefined();
    if (p) {
      expect(p.corsHint).toBe('direct');
      expect(p.offerings).toHaveLength(4);
      expect(p.sortPriority).toBe(14);
    }
  });

  it('openrouter has direct CORS hint, eight offerings, and sortPriority 45', () => {
    const p = getProvider('openrouter');
    expect(p).toBeDefined();
    if (p) {
      expect(p.corsHint).toBe('direct');
      expect(p.offerings).toHaveLength(8);
      expect(p.sortPriority).toBe(45);
    }
  });

  it('registers the eight Claude offerings on nano-gpt with the cache adapter and CENSORED freedom', () => {
    const p = getProvider('nano-gpt');
    expect(p).toBeDefined();
    const claude = p?.offerings.filter((o) => o.canonicalRef?.startsWith('claude-')) ?? [];
    expect(claude.map((o) => o.canonicalRef).sort()).toEqual([
      'claude-fable-5',
      'claude-haiku-4.5',
      'claude-opus-4.5',
      'claude-opus-4.6',
      'claude-opus-4.7',
      'claude-opus-4.8',
      'claude-sonnet-4.5',
      'claude-sonnet-4.6',
    ]);
    for (const o of claude) {
      expect(o.adapter.kind).toBe('catalogue');
      if (o.adapter.kind === 'catalogue') {
        expect(o.adapter.adapterId).toBe(`nano-gpt:${o.upstreamSlug}`);
      }
      expect(o.freedomOrientedDeployment).toBe(true);
      const canonical = getCanonical(o.canonicalRef ?? '');
      expect(canonical?.freedomOriented).toBe(false);
      expect(
        effectiveFreedom(canonical?.freedomOriented ?? null, o.freedomOrientedDeployment),
      ).toBe('restricted');
    }
  });

  it('chutes has direct CORS hint, five TEE models, and sortPriority 10', () => {
    const p = getProvider('chutes');
    expect(p).toBeDefined();
    if (p) {
      expect(p.corsHint).toBe('direct');
      expect(p.offerings).toHaveLength(5);
      expect(p.sortPriority).toBe(10);
    }
  });

  it('wafer requires a proxy (no CORS), has five offerings (3 ZDR), and sortPriority 15', () => {
    const p = getProvider('wafer');
    expect(p).toBeDefined();
    if (p) {
      expect(p.corsHint).toBe('requires-proxy');
      expect(p.offerings).toHaveLength(5);
      expect(p.sortPriority).toBe(15);
      // GLM-5.1, Kimi-K2.6, Qwen3.5 are ZDR; the two DeepSeek V4 are not.
      expect(p.offerings.filter((o) => o.trust.zdr).length).toBe(3);
    }
  });

  it('novita has direct CORS hint', () => {
    const p = getProvider('novita');
    expect(p).toBeDefined();
    if (p) {
      expect(p.corsHint).toBe('direct');
      expect(p.offerings).toHaveLength(8);
    }
  });

  it('ollama-cloud has 2 LLM offerings + 2 web offerings (search/fetch)', () => {
    const p = getProvider('ollama-cloud');
    expect(p).toBeDefined();
    if (p) {
      expect(p.corsHint).toBe('requires-proxy');
      expect(p.offerings).toHaveLength(4);

      const llm = p.offerings.filter((o) => o.serviceKind === 'llm');
      expect(llm.map((o) => o.upstreamSlug).sort()).toEqual(['deepseek-v4-pro', 'glm-5.1']);
      expect(llm.every((o) => o.confidence === 'verified')).toBe(true);
      expect(llm.every((o) => o.adapter.kind === 'catalogue')).toBe(true);
      expect(llm.every((o) => o.profile.reasoning.mode === 'fixed-on')).toBe(true);

      const web = p.offerings.filter((o) => o.serviceKind === 'web');
      expect(web.map((o) => o.upstreamSlug).sort()).toEqual([
        'web-ollama-fetch',
        'web-ollama-search',
      ]);
      const search = web.find((o) => o.upstreamSlug === 'web-ollama-search');
      expect(search?.web?.canSearch).toBe(true);
      expect(search?.web?.requiresProxy).toBe(true);
      expect(search?.web?.traits).toEqual(['ai']);
      expect(search?.web?.searchTiers?.[0]?.id).toBe('standard');
      expect(search?.web?.searchTiers?.map((t) => t.id)).toEqual(['standard', 'quick', 'deep']);
      const fetch = web.find((o) => o.upstreamSlug === 'web-ollama-fetch');
      expect(fetch?.web?.canFetch).toBe(true);
      expect(fetch?.web?.canSearch).toBe(false);
    }
  });

  it('registers xai with grok-4.3 (llm) and grok-imagine-image (tti)', () => {
    const p = getProvider('xai');
    expect(p?.corsHint).toBe('requires-proxy');
    expect(p?.capabilities).toContain('vision');
    expect(p?.offerings).toHaveLength(2);
    const llm = p?.offerings.find((o) => o.serviceKind === 'llm');
    expect(llm?.canonicalRef).toBe('grok-4.3');
    expect(llm?.context).toEqual({ recommended: 200_000, max: 1_000_000 });
    expect(llm?.trust).toEqual({ tee: false, zdr: false, jurisdiction: 'US' });
    expect(llm?.freedomOrientedDeployment).toBe(true);
    expect(llm?.confidence).toBe('verified');
    const tti = p?.offerings.find((o) => o.serviceKind === 'tti');
    expect(tti?.upstreamSlug).toBe('grok-imagine-image');
    expect(tti?.tti?.groupId).toBe('xai-imagine');
    expect(tti?.tti?.canDoNsfw).toBe(false);
    expect(tti?.tti?.displayName).toBe('Grok Imagine');
  });

  it('nano-gpt has 3 web search offerings + 1 fetch offering with traits/tiers', () => {
    const p = getProvider('nano-gpt');
    const web = (p?.offerings ?? []).filter((o) => o.serviceKind === 'web');
    expect(web).toHaveLength(4);

    const linkup = web.find((o) => o.upstreamSlug === 'web-linkup');
    expect(linkup?.web?.canSearch).toBe(true);
    expect(linkup?.web?.requiresProxy).toBe(true);
    expect(linkup?.web?.traits).toEqual(['recommended', 'ai']);
    expect(linkup?.web?.searchTiers?.[0]?.id).toBe('standard');

    const exa = web.find((o) => o.upstreamSlug === 'web-exa');
    expect(exa?.web?.traits).toEqual(['ai', 'neural']);
    expect(exa?.web?.searchTiers?.map((t) => t.id)).toEqual(['quick', 'neural']);

    const brave = web.find((o) => o.upstreamSlug === 'web-brave');
    expect(brave?.web?.traits).toEqual(['privacy']);

    const scrape = web.find((o) => o.upstreamSlug === 'web-scrape');
    expect(scrape?.web?.canFetch).toBe(true);
    expect(scrape?.web?.canSearch).toBe(false);
  });

  it('every built-in declares an api_key config field marked secret + required', () => {
    for (const p of listProviders()) {
      const apiKey = p.configFields.find((f) => f.key === 'api_key');
      expect(apiKey).toBeDefined();
      if (apiKey) {
        expect(apiKey.secret).toBe(true);
        expect(apiKey.required).toBe(true);
      }
      expect(p.secretFields.has('api_key')).toBe(true);
    }
  });

  it('every built-in declares a GET models probe', () => {
    for (const p of listProviders()) {
      // Most providers sit on the OpenAI-compat `/models`; ollama-cloud's baseUrl
      // is the bare host (its native adapter targets /api/chat), so it probes the
      // explicit `/v1/models` listing instead.
      const expected = p.id === 'ollama-cloud' ? '/v1/models' : '/models';
      expect(p.probe.path).toBe(expected);
      expect(p.probe.method).toBe('GET');
    }
  });
});
