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
      // 6 original + 3 Mistral (small-4, medium-3.5, large-3) + 7 Claude = 16.
      expect(p.offerings).toHaveLength(16);
      expect(p.shape).toBe('openai-chat-completions');
    }
  });

  it('mistral has direct CORS hint, three offerings, and sortPriority 14', () => {
    const p = getProvider('mistral');
    expect(p).toBeDefined();
    if (p) {
      expect(p.corsHint).toBe('direct');
      expect(p.offerings).toHaveLength(3);
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

  it('registers the seven Claude offerings on nano-gpt with the cache adapter and CENSORED freedom', () => {
    const p = getProvider('nano-gpt');
    expect(p).toBeDefined();
    const claude = p?.offerings.filter((o) => o.canonicalRef?.startsWith('claude-')) ?? [];
    expect(claude.map((o) => o.canonicalRef).sort()).toEqual([
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

  it('ollama-cloud requires proxy', () => {
    const p = getProvider('ollama-cloud');
    expect(p).toBeDefined();
    if (p) {
      expect(p.corsHint).toBe('requires-proxy');
      expect(p.offerings).toHaveLength(6);
    }
  });

  it('registers xai with a single verified grok-4.3 offering', () => {
    const p = getProvider('xai');
    expect(p?.corsHint).toBe('requires-proxy');
    expect(p?.capabilities).toContain('vision');
    expect(p?.offerings).toHaveLength(1);
    const o = p?.offerings[0];
    expect(o?.canonicalRef).toBe('grok-4.3');
    expect(o?.context).toEqual({ recommended: 200_000, max: 1_000_000 });
    expect(o?.trust).toEqual({ tee: false, zdr: false, jurisdiction: 'US' });
    expect(o?.freedomOrientedDeployment).toBe(true);
    expect(o?.confidence).toBe('verified');
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

  it('every built-in declares a probe at /models GET', () => {
    for (const p of listProviders()) {
      expect(p.probe.path).toBe('/models');
      expect(p.probe.method).toBe('GET');
    }
  });
});
