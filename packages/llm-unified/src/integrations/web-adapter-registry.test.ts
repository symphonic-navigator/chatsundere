// SPDX-License-Identifier: LGPL-3.0-only
import { afterEach, describe, expect, it } from 'bun:test';
import {
  _resetWebAdapterRegistryForTests,
  registerWebAdapter,
  resolveWebAdapter,
} from './web-adapter-registry.js';
import type { WebInterfacingProvider } from './web-interfacing.js';

describe('web-adapter-registry', () => {
  afterEach(() => _resetWebAdapterRegistryForTests());

  it('returns null for an unregistered adapter id (empty today)', () => {
    expect(resolveWebAdapter('nano-gpt-brave')).toBeNull();
  });

  it('resolves a registered adapter via its factory', () => {
    const fake: WebInterfacingProvider = {
      search: async (query) => ({ query, hits: [] }),
    };
    registerWebAdapter('nano-gpt-brave', () => fake);
    expect(resolveWebAdapter('nano-gpt-brave')).toBe(fake);
  });

  it('reset clears all registrations', () => {
    registerWebAdapter('x', () => ({}));
    _resetWebAdapterRegistryForTests();
    expect(resolveWebAdapter('x')).toBeNull();
  });
});
