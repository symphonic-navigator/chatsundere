// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from 'bun:test';
import { groupNanoGptSlugs } from './provider-scanner.js';

describe('groupNanoGptSlugs', () => {
  it('groups bare + :thinking into one offering, and TEE into its own', () => {
    const groups = groupNanoGptSlugs([
      'zai-org/glm-6',
      'zai-org/glm-6:thinking',
      'TEE/glm-6',
      'TEE/glm-6-thinking',
      'deepseek/deepseek-v4-pro',
    ]);
    const glm = groups.find((g) => g.baseSlug === 'zai-org/glm-6' && !g.teeVariant);
    expect(glm?.reasoningVariant).toBe('zai-org/glm-6:thinking');
    const tee = groups.find((g) => g.teeVariant);
    expect(tee?.baseSlug).toBe('TEE/glm-6');
    expect(tee?.reasoningVariant).toBe('TEE/glm-6-thinking');
    expect(groups.some((g) => g.baseSlug === 'deepseek/deepseek-v4-pro')).toBe(true);
  });
});
