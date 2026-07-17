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
      // 7 original (incl. glm-5.2) + 3 Mistral (small-4, medium-3.5, large-3)
      // + 8 Claude + 2 Grok (4.3, 4.5, llm) + 6 ChatGPT (OpenAI, censored) + 4 web
      // + 3 tti + 2 Grok voice (tts + stt) + 1 Inkling = 36.
      expect(p.offerings).toHaveLength(36);
      expect(p.shape).toBe('openai-chat-completions');
    }
  });

  it('mistral has direct CORS hint, five offerings (3 LLM + 1 TTS + 1 STT), and sortPriority 14', () => {
    const p = getProvider('mistral');
    expect(p).toBeDefined();
    if (p) {
      expect(p.corsHint).toBe('direct');
      expect(p.offerings).toHaveLength(5);
      expect(p.sortPriority).toBe(14);
    }
  });

  it('openrouter has direct CORS hint, nineteen offerings, and sortPriority 45', () => {
    const p = getProvider('openrouter');
    expect(p).toBeDefined();
    if (p) {
      expect(p.corsHint).toBe('direct');
      // 8 original + 1 Kimi K3 (freedom unknown) + 3 Grok (4.3, 4.5, 4.20 — all
      // ZDR-enforced) + Claude Sonnet 5 + 6 ChatGPT (OpenAI, censored) = 19.
      expect(p.offerings).toHaveLength(19);
      expect(p.sortPriority).toBe(45);
    }
  });

  it('offers grok-4.5 on openrouter as the ZDR route with mandatory reasoning', () => {
    const grok45 = getProvider('openrouter')?.offerings.find((o) => o.canonicalRef === 'grok-4.5');
    expect(grok45?.upstreamSlug).toBe('x-ai/grok-4.5');
    // OpenRouter is the ZDR path for Grok; the adapter enforces it on the wire.
    expect(grok45?.trust).toEqual({ tee: false, zdr: true, jurisdiction: 'US' });
    // Reasoning is mandatory upstream: OpenRouter answers `{enabled:false}` with
    // HTTP 400 "Reasoning is mandatory for this endpoint" → no off step.
    expect(grok45?.profile.reasoning).toEqual({
      mode: 'steps',
      steps: ['low', 'medium', 'high'],
      offStep: null,
      defaultStep: 'low',
    });
    expect(grok45?.context).toEqual({ recommended: 200_000, max: 500_000 });
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

  it('chutes has direct CORS hint, six TEE models, and sortPriority 10', () => {
    const p = getProvider('chutes');
    expect(p).toBeDefined();
    if (p) {
      expect(p.corsHint).toBe('direct');
      expect(p.offerings).toHaveLength(6);
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
      expect(p.offerings).toHaveLength(9);
    }
  });

  it('ollama-cloud has 3 LLM offerings + 2 web offerings (search/fetch)', () => {
    const p = getProvider('ollama-cloud');
    expect(p).toBeDefined();
    if (p) {
      expect(p.corsHint).toBe('requires-proxy');
      expect(p.offerings).toHaveLength(5);

      const llm = p.offerings.filter((o) => o.serviceKind === 'llm');
      expect(llm.map((o) => o.upstreamSlug).sort()).toEqual([
        'deepseek-v4-pro',
        'glm-5.1',
        'glm-5.2:cloud',
      ]);
      expect(llm.every((o) => o.confidence === 'verified')).toBe(true);
      expect(llm.every((o) => o.adapter.kind === 'catalogue')).toBe(true);
      // Reasoning steerability is PER MODEL here, not a provider-wide trait
      // (live-measured 2026-07-17, n=5 x 2 reasoning-warranting prompts).
      // glm-5.1 / deepseek-v4-pro: `think:false` genuinely stops the thinking
      // (eval_count -50%..-72%, answer length unchanged) → toggle.
      // glm-5.2: `think:false` empties the thinking channel but moves the
      // reasoning into the answer (content 3-4x longer) → fixed-on, since "off"
      // would only make replies longer, never cheaper.
      const modes = Object.fromEntries(llm.map((o) => [o.upstreamSlug, o.profile.reasoning.mode]));
      expect(modes).toEqual({
        'glm-5.1': 'toggle',
        'deepseek-v4-pro': 'toggle',
        'glm-5.2:cloud': 'fixed-on',
      });
      const toggles = llm.filter((o) => o.profile.reasoning.mode === 'toggle');
      expect(
        toggles.every(
          (o) => o.profile.reasoning.mode === 'toggle' && o.profile.reasoning.defaultOn,
        ),
      ).toBe(true);
      // ZDR is scoped to GLM 5.2 only (deployment-level, US/EU hosting); the
      // other ollama models carry no such statement.
      expect(llm.find((o) => o.upstreamSlug === 'glm-5.2:cloud')?.trust.zdr).toBe(true);
      expect(llm.filter((o) => o.trust.zdr).map((o) => o.upstreamSlug)).toEqual(['glm-5.2:cloud']);

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

  it('registers grok-4.3 + grok-4.5 + grok-4.20 (llm), grok-imagine-image (tti) and the two voice offerings', () => {
    const p = getProvider('xai');
    expect(p?.corsHint).toBe('requires-proxy');
    expect(p?.capabilities).toContain('vision');
    expect(p?.offerings).toHaveLength(6);
    const llm = p?.offerings.find((o) => o.canonicalRef === 'grok-4.3');
    expect(llm?.serviceKind).toBe('llm');
    expect(llm?.context).toEqual({ recommended: 200_000, max: 1_000_000 });
    expect(llm?.trust).toEqual({ tee: false, zdr: false, jurisdiction: 'US' });
    expect(llm?.freedomOrientedDeployment).toBe(true);
    expect(llm?.confidence).toBe('verified');
    // Grok 4.5: reasoning is MANDATORY (`reasoning_effort: 'none'` is HTTP 400),
    // so the steps control carries offStep null; 500k ceiling, NOT 4.3's 1M.
    const grok45 = p?.offerings.find((o) => o.canonicalRef === 'grok-4.5');
    expect(grok45?.upstreamSlug).toBe('grok-4.5');
    expect(grok45?.context).toEqual({ recommended: 200_000, max: 500_000 });
    expect(grok45?.profile.reasoning).toEqual({
      mode: 'steps',
      steps: ['low', 'medium', 'high'],
      offStep: null,
      defaultStep: 'low',
    });
    expect(grok45?.trust).toEqual({ tee: false, zdr: false, jurisdiction: 'US' });
    // Grok 4.20: slug-swap reasoning, distinct dated base slug, 2M ceiling.
    const grok420 = p?.offerings.find((o) => o.canonicalRef === 'grok-4.20');
    expect(grok420?.upstreamSlug).toBe('grok-4.20-0309-non-reasoning');
    expect(grok420?.context).toEqual({ recommended: 200_000, max: 2_000_000 });
    expect(grok420?.profile.reasoning).toEqual({ mode: 'toggle', defaultOn: true });
    const tti = p?.offerings.find((o) => o.serviceKind === 'tti');
    expect(tti?.upstreamSlug).toBe('grok-imagine-image');
    expect(tti?.tti?.groupId).toBe('xai-imagine');
    expect(tti?.tti?.canDoNsfw).toBe(false);
    expect(tti?.tti?.displayName).toBe('Grok Imagine');
  });

  // Corrected 2026-07-15. nano-gpt ACCEPTS `reasoning:{enabled:false}` for Grok
  // 4.5 but only hides the trace: it reports `reasoning_tokens: 0` while the
  // model reasons anyway and the user is billed for it (a one-token answer cost
  // 198 completion tokens). Reasoning is mandatory upstream on every route, so
  // the honest control is fixed-on — an off switch here would be a lie.
  it('models grok-4.5 on nano-gpt as fixed-on, since its reasoning-off only hides', () => {
    const grok45 = getProvider('nano-gpt')?.offerings.find((o) => o.canonicalRef === 'grok-4.5');
    expect(grok45?.upstreamSlug).toBe('x-ai/grok-4.5');
    expect(grok45?.profile.reasoning).toEqual({ mode: 'fixed-on' });
    // The real xAI ceiling — 4.3's 1M was mirrored here by mistake.
    expect(grok45?.context).toEqual({ recommended: 200_000, max: 500_000 });
    expect(grok45?.trust).toEqual({ tee: false, zdr: false, jurisdiction: 'US' });
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
