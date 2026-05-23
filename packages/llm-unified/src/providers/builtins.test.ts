// SPDX-License-Identifier: LGPL-3.0-only

import { beforeAll, describe, expect, it } from 'bun:test';
import { _resetRegistryForTests, getProvider, listProviders } from '../registry.js';
import { registerBuiltinProviders } from './_register-builtins.js';

beforeAll(() => {
  _resetRegistryForTests();
  registerBuiltinProviders();
});

describe('built-in providers', () => {
  it('registers nano-gpt, novita, ollama-cloud — exactly three', () => {
    const ids = listProviders().map((p) => p.id);
    expect(ids).toEqual(['nano-gpt', 'novita', 'ollama-cloud']);
  });

  it('nano-gpt has inofficial CORS hint and one known model', () => {
    const p = getProvider('nano-gpt');
    expect(p).toBeDefined();
    if (p) {
      expect(p.corsHint).toBe('inofficial');
      expect(p.knownModels.map((m) => m.id)).toEqual(['deepseek-v4-flash']);
      expect(p.shape).toBe('openai-chat-completions');
    }
  });

  it('novita has direct CORS hint and GLM 5.1', () => {
    const p = getProvider('novita');
    expect(p).toBeDefined();
    if (p) {
      expect(p.corsHint).toBe('direct');
      expect(p.knownModels.map((m) => m.id)).toEqual(['glm-5.1']);
    }
  });

  it('ollama-cloud requires proxy and has Kimi K2.6', () => {
    const p = getProvider('ollama-cloud');
    expect(p).toBeDefined();
    if (p) {
      expect(p.corsHint).toBe('requires-proxy');
      expect(p.knownModels.map((m) => m.id)).toEqual(['kimi-k2.6']);
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
