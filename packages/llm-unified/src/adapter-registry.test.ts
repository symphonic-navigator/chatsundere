// SPDX-License-Identifier: LGPL-3.0-only
import { afterEach, describe, expect, test } from 'bun:test';
import type {
  CanonicalRequest,
  ModelAdapter,
  ParseState,
  WireRequest,
} from './adapter-contract.js';
import { _resetAdapterRegistryForTests, getAdapter, registerAdapter } from './adapter-registry.js';

const stub: ModelAdapter = {
  profile: {
    reasoning: { mode: 'none' },
    toolCalls: { supported: false, streaming: false, concurrentWithReasoning: false },
    vision: false,
    replayReasoning: false,
  },
  buildRequest(_req: CanonicalRequest): WireRequest {
    return { model: 'm', body: {} };
  },
  parseChunk(_raw: unknown, state: ParseState) {
    return { events: [], state };
  },
};

afterEach(() => _resetAdapterRegistryForTests());

describe('adapter-registry', () => {
  test('register then get returns the adapter', () => {
    registerAdapter('stub', stub);
    expect(getAdapter('stub')).toBe(stub);
  });
  test('get on an unknown id returns undefined', () => {
    expect(getAdapter('nope')).toBeUndefined();
  });
  test('duplicate registration throws', () => {
    registerAdapter('stub', stub);
    expect(() => registerAdapter('stub', stub)).toThrow("adapter 'stub' already registered");
  });
  test('reset clears the registry', () => {
    registerAdapter('stub', stub);
    _resetAdapterRegistryForTests();
    expect(getAdapter('stub')).toBeUndefined();
  });
});
