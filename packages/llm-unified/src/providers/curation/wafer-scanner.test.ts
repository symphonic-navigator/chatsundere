// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import { groupWaferModels } from './wafer-scanner.js';

describe('groupWaferModels', () => {
  test('one offering per model id; zdr_supported is not carried into discovery', () => {
    const offerings = groupWaferModels([
      { id: 'GLM-5.1', zdr_supported: true },
      { id: 'deepseek-v4-flash', zdr_supported: false },
      { id: 'Qwen3.5-397B-A17B' },
    ]);
    expect(offerings).toEqual([
      { providerId: 'wafer', baseSlug: 'GLM-5.1' },
      { providerId: 'wafer', baseSlug: 'deepseek-v4-flash' },
      { providerId: 'wafer', baseSlug: 'Qwen3.5-397B-A17B' },
    ]);
  });
});
