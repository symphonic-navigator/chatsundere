// SPDX-License-Identifier: AGPL-3.0-only
import type { SearchTier } from '@chatsundere/llm-unified';
import { describe, expect, it } from 'vitest';
import { initialTierId, resolveTierId } from '../../src/lib/web-search-resolver.js';

const tiers: SearchTier[] = [
  { id: 'quick', label: 'Quick', params: { depth: 'auto' } },
  { id: 'neural', label: 'Neural', params: { depth: 'neural' } },
];

describe('web-search-resolver', () => {
  it('initial tier is the first (default)', () => {
    expect(initialTierId(tiers)).toBe('quick');
    expect(initialTierId([])).toBeNull();
  });
  it('resolves a selected id, falling back to the default when stale', () => {
    expect(resolveTierId('neural', tiers)).toBe('neural');
    expect(resolveTierId('gone', tiers)).toBe('quick');
    expect(resolveTierId(null, tiers)).toBe('quick');
  });
  it('resolves to null when there are no tiers', () => {
    expect(resolveTierId('x', [])).toBeNull();
  });
});
