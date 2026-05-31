// SPDX-License-Identifier: LGPL-3.0-only

import { beforeAll, describe, expect, it } from 'bun:test';
import { _resetRegistryForTests, getProvider, listProviders } from '../registry.js';
import { registerBuiltinProviders } from './_register-builtins.js';

beforeAll(() => {
  _resetRegistryForTests();
  registerBuiltinProviders();
});

describe('built-in providers', () => {
  it('registers chutes, tensorix, wafer, novita, ollama-cloud, nano-gpt — exactly six, in sortPriority order', () => {
    const ids = listProviders().map((p) => p.id);
    expect(ids).toEqual(['chutes', 'tensorix', 'wafer', 'novita', 'ollama-cloud', 'nano-gpt']);
  });

  it('nano-gpt has inofficial CORS hint and openai-chat-completions shape', () => {
    const p = getProvider('nano-gpt');
    expect(p).toBeDefined();
    if (p) {
      expect(p.corsHint).toBe('inofficial');
      expect(p.offerings).toHaveLength(6);
      expect(p.shape).toBe('openai-chat-completions');
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
