// SPDX-License-Identifier: LGPL-3.0-only

import { beforeEach, describe, expect, it } from 'bun:test';
import {
  _resetRegistryForTests,
  getProvider,
  listProviders,
  registerProvider,
} from './registry.js';
import type { ProviderDefinition } from './types.js';

function makeDef(id: string, sortPriority = 100): ProviderDefinition {
  return {
    id,
    displayName: `provider-${id}`,
    iconKey: id,
    baseUrl: `https://${id}.example.com`,
    shape: 'openai-chat-completions',
    capabilities: ['llm', 'streaming'],
    configFields: [],
    probe: { path: '/models', method: 'GET' },
    secretFields: new Set(['api_key']),
    corsHint: 'direct',
    offerings: [],
    sortPriority,
  };
}

beforeEach(() => {
  _resetRegistryForTests();
});

describe('provider registry', () => {
  it('registers and retrieves a provider', () => {
    const defn = makeDef('alpha');
    registerProvider(defn);
    expect(getProvider('alpha')).toBe(defn);
  });

  it('returns undefined for unknown provider ids', () => {
    expect(getProvider('nope')).toBeUndefined();
  });

  it('throws on duplicate registration', () => {
    registerProvider(makeDef('alpha'));
    expect(() => registerProvider(makeDef('alpha'))).toThrow(/already registered/);
  });

  it('lists providers sorted by sortPriority ascending, then by registration order', () => {
    const a = makeDef('alpha', 30);
    const b = makeDef('bravo', 10);
    const c = makeDef('charlie', 20);
    const d = makeDef('delta', 20); // ties broken by registration order
    registerProvider(a);
    registerProvider(b);
    registerProvider(c);
    registerProvider(d);
    expect(listProviders().map((p) => p.id)).toEqual(['bravo', 'charlie', 'delta', 'alpha']);
  });

  it('listProviders returns a copy (mutations do not leak back into registry)', () => {
    registerProvider(makeDef('alpha'));
    const list = listProviders();
    list.pop();
    expect(listProviders().length).toBe(1);
  });
});
