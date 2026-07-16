// SPDX-License-Identifier: LGPL-3.0-only
import { afterAll, beforeAll, describe, expect, it, test } from 'bun:test';
import { _resetAdapterRegistryForTests } from '../adapter-registry.js';
import { registerBuiltinProviders } from '../providers/_register-builtins.js';
import { _resetRegistryForTests, listOfferings } from '../registry.js';
import {
  CANONICALS,
  availableCanonicals,
  getCanonical,
  isUnsuitableAsBackgroundWorker,
  listCanonicals,
  resolveModelInstructions,
} from './canonical-registry.js';
import { MISTRAL_FORMATTING_INSTRUCTIONS } from './model-instructions.js';

// registerBuiltinProviders also registers catalogue adapters, which throw on
// duplicate ids — so clear BOTH registries before registering, else a prior
// test file that registered builtins (the adapter registry is a shared
// module-level singleton across files) makes this throw.
beforeAll(() => {
  _resetRegistryForTests();
  _resetAdapterRegistryForTests();
  registerBuiltinProviders();
});
afterAll(() => {
  _resetRegistryForTests();
  _resetAdapterRegistryForTests();
});

describe('canonical-registry', () => {
  test('lists thirty-four canonicals with unique ids', () => {
    const ids = listCanonicals().map((c) => c.id);
    expect(ids).toHaveLength(34);
    expect(new Set(ids).size).toBe(34);
    expect(ids).toContain('claude-sonnet-5');
    expect(ids).toContain('grok-4.3');
    expect(ids).toContain('grok-4.20');
    expect(ids).toContain('grok-4.5');
    expect(ids).toContain('glm-5.1');
    expect(ids).toContain('glm-5.2');
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
    expect(ids).toContain('claude-fable-5');
    // ChatGPT (OpenAI) family — censored, CENSORED badge (2026-07-06)
    expect(ids).toContain('chatgpt-4o');
    expect(ids).toContain('chatgpt-4o-2024-11-20');
    expect(ids).toContain('chatgpt-4.1');
    expect(ids).toContain('chatgpt-5');
    expect(ids).toContain('chatgpt-5.4');
    expect(ids).toContain('chatgpt-5.5');
  });

  test('getCanonical returns by id and undefined for unknown', () => {
    expect(getCanonical('kimi-k2.6')?.displayName).toBe('Kimi K2.6');
    expect(getCanonical('nope')).toBeUndefined();
  });

  test('CANONICALS is the source listCanonicals copies', () => {
    expect(listCanonicals()).toEqual([...CANONICALS]);
    expect(listCanonicals()).not.toBe(CANONICALS); // fresh array
  });

  it('includes the grok-4.3 canonical with vision + reasoning + tools', () => {
    const grok = CANONICALS.find((c) => c.id === 'grok-4.3');
    expect(grok).toBeDefined();
    expect(grok?.requiredCaps).toEqual({ tools: true, reasoning: true, vision: true });
    expect(grok?.freedomOriented).toBe(true);
    expect(grok?.family).toBe('grok');
  });
});

describe('unsuitableAsBackgroundWorker', () => {
  test('every DeepSeek canonical is flagged', () => {
    for (const id of ['deepseek-v3.2', 'deepseek-v4-flash', 'deepseek-v4-pro']) {
      const c = getCanonical(id);
      expect(c).toBeDefined();
      // biome-ignore lint/style/noNonNullAssertion: asserted defined above
      expect(isUnsuitableAsBackgroundWorker(c!)).toBe(true);
    }
  });

  test('non-DeepSeek canonicals are suitable (flag absent)', () => {
    for (const id of ['glm-5', 'grok-4.3', 'kimi-k2.6', 'claude-sonnet-5']) {
      const c = getCanonical(id);
      expect(c).toBeDefined();
      // biome-ignore lint/style/noNonNullAssertion: asserted defined above
      expect(isUnsuitableAsBackgroundWorker(c!)).toBe(false);
      // biome-ignore lint/style/noNonNullAssertion: asserted defined above
      expect(c!.unsuitableAsBackgroundWorker).toBeUndefined();
    }
  });

  test('the flag currently marks exactly the DeepSeek family', () => {
    const flagged = CANONICALS.filter(isUnsuitableAsBackgroundWorker).map((c) => c.id);
    expect(flagged.sort()).toEqual(['deepseek-v3.2', 'deepseek-v4-flash', 'deepseek-v4-pro']);
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

describe('modelInstructions', () => {
  test('all three Mistral canonicals share the formatting restraint', () => {
    for (const id of ['mistral-small-4', 'mistral-medium-3-5', 'mistral-large-3']) {
      expect(getCanonical(id)?.modelInstructions).toBe(MISTRAL_FORMATTING_INSTRUCTIONS);
    }
  });

  test('non-Mistral canonicals carry none', () => {
    expect(getCanonical('glm-5')?.modelInstructions).toBeUndefined();
    expect(getCanonical('grok-4.3')?.modelInstructions).toBeUndefined();
  });

  test('resolveModelInstructions resolves via canonicalRef, empty otherwise', () => {
    expect(resolveModelInstructions({ canonicalRef: 'mistral-small-4' })).toBe(
      MISTRAL_FORMATTING_INSTRUCTIONS,
    );
    expect(resolveModelInstructions({ canonicalRef: null })).toBe('');
    expect(resolveModelInstructions({ canonicalRef: 'unknown-model' })).toBe('');
    expect(resolveModelInstructions({ canonicalRef: 'glm-5' })).toBe('');
  });
});
