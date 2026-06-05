// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from 'bun:test';
import { type TensorixModelEntry, groupTensorixModels } from './tensorix-scanner.js';

describe('groupTensorixModels', () => {
  it('maps each model id to one offering', () => {
    const models: TensorixModelEntry[] = [
      { id: 'z-ai/glm-5.1' },
      { id: 'deepseek/deepseek-v4-pro' },
      { id: 'moonshotai/kimi-k2.6' },
    ];
    const offerings = groupTensorixModels(models);
    expect(offerings).toHaveLength(3);
    expect(offerings[0]).toEqual({ providerId: 'tensorix', baseSlug: 'z-ai/glm-5.1' });
  });

  it('deduplicates case-insensitive slug duplicates, keeping the first', () => {
    const models: TensorixModelEntry[] = [
      { id: 'moonshotai/Kimi-K2.6' },
      { id: 'moonshotai/kimi-k2.6' },
    ];
    const offerings = groupTensorixModels(models);
    expect(offerings).toHaveLength(1);
    expect(offerings[0]?.baseSlug).toBe('moonshotai/Kimi-K2.6');
  });
});
