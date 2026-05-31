// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import { CANONICALS, getCanonical, listCanonicals } from './canonical-registry.js';

describe('canonical-registry', () => {
  test('lists thirteen canonicals with unique ids', () => {
    const ids = listCanonicals().map((c) => c.id);
    expect(ids).toHaveLength(13);
    expect(new Set(ids).size).toBe(13);
    expect(ids).toContain('glm-5.1');
    expect(ids).toContain('deepseek-v3.2');
    expect(ids).toContain('qwen3.5-397b-a17b');
    expect(ids).toContain('mimo-v2.5-omni');
    expect(ids).toContain('mimo-v2.5-pro');
    expect(ids).toContain('mistral-small-4');
    expect(ids).toContain('mistral-medium-3-5');
    expect(ids).toContain('mistral-large-3');
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
