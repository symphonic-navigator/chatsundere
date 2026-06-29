import { describe, expect, it } from 'vitest';
import { resolveVectorStrategy } from '../../../src/lib/chatsundere-transfer/vector-strategy.js';

const ENGINE = { modelId: 'Snowflake/snowflake-arctic-embed-m-v2.0', dim: 768, codecVersion: 1 };

describe('resolveVectorStrategy', () => {
  it('adopts when model, dim, and codec all match', () => {
    expect(resolveVectorStrategy({ ...ENGINE }, ENGINE)).toBe('adopt');
  });
  it('re-embeds on a model mismatch', () => {
    expect(resolveVectorStrategy({ ...ENGINE, modelId: 'other' }, ENGINE)).toBe('reembed');
  });
  it('re-embeds on a dimension mismatch', () => {
    expect(resolveVectorStrategy({ ...ENGINE, dim: 384 }, ENGINE)).toBe('reembed');
  });
  it('re-embeds on a codec-version mismatch', () => {
    expect(resolveVectorStrategy({ ...ENGINE, codecVersion: 2 }, ENGINE)).toBe('reembed');
  });
});
