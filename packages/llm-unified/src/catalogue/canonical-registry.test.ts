// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import { CANONICALS, getCanonical, listCanonicals } from './canonical-registry.js';

describe('canonical-registry', () => {
  test('lists seven canonicals with unique ids', () => {
    const ids = listCanonicals().map((c) => c.id);
    expect(ids).toHaveLength(7);
    expect(new Set(ids).size).toBe(7);
    expect(ids).toContain('glm-5.1');
    expect(ids).toContain('deepseek-v3.2');
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
