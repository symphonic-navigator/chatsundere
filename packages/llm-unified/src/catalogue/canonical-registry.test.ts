// SPDX-License-Identifier: LGPL-3.0-only
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { registerBuiltinProviders } from '../providers/_register-builtins.js';
import { _resetRegistryForTests, listOfferings } from '../registry.js';
import {
  CANONICALS,
  availableCanonicals,
  getCanonical,
  listCanonicals,
} from './canonical-registry.js';

// registerBuiltinProviders also registers catalogue adapters, which have no
// reset hook and throw on duplicate ids — so register once, like
// registry.modality.test.ts.
beforeAll(() => {
  _resetRegistryForTests();
  registerBuiltinProviders();
});
afterAll(() => _resetRegistryForTests());

describe('canonical-registry', () => {
  test('lists twenty canonicals with unique ids', () => {
    const ids = listCanonicals().map((c) => c.id);
    expect(ids).toHaveLength(20);
    expect(new Set(ids).size).toBe(20);
    expect(ids).toContain('glm-5.1');
    expect(ids).toContain('deepseek-v3.2');
    expect(ids).toContain('qwen3.5-397b-a17b');
    expect(ids).toContain('mimo-v2.5-omni');
    expect(ids).toContain('mimo-v2.5-pro');
    expect(ids).toContain('mistral-small-4');
    expect(ids).toContain('mistral-medium-3-5');
    expect(ids).toContain('mistral-large-3');
    // Claude family (ADR 0032)
    expect(ids).toContain('claude-haiku-4.5');
    expect(ids).toContain('claude-sonnet-4.6');
    expect(ids).toContain('claude-opus-4.8');
  });

  test('getCanonical returns by id and undefined for unknown', () => {
    expect(getCanonical('kimi-k2.6')?.displayName).toBe('Kimi K2.6');
    expect(getCanonical('nope')).toBeUndefined();
  });

  test('CANONICALS is the source listCanonicals copies', () => {
    expect(listCanonicals()).toEqual([...CANONICALS]);
    expect(listCanonicals()).not.toBe(CANONICALS); // fresh array
  });
});

describe('availableCanonicals', () => {
  test('no configured providers hides everything', () => {
    const total = listCanonicals().length;
    const { available, hiddenCount } = availableCanonicals([]);
    expect(available).toEqual([]);
    expect(hiddenCount).toBe(total);
  });

  test('configuring wafer surfaces only canonicals with a wafer offering', () => {
    const total = listCanonicals().length;
    const { available, hiddenCount } = availableCanonicals(['wafer']);

    expect(available.length).toBeGreaterThan(0);
    expect(available.length).toBeLessThan(total);
    expect(hiddenCount).toBe(total - available.length);

    for (const c of available) {
      expect(listOfferings(c.id).some((o) => o.providerId === 'wafer')).toBe(true);
    }
  });
});
