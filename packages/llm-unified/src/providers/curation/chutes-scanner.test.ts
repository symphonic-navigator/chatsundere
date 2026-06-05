// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import { groupChutesModels } from './chutes-scanner.js';

describe('groupChutesModels', () => {
  test('one offering per model; teeVariant tracks confidential_compute', () => {
    const offerings = groupChutesModels([
      { id: 'deepseek-ai/DeepSeek-V3.2-TEE', confidential_compute: true },
      { id: 'some/non-tee-model', confidential_compute: false },
      { id: 'other/no-flag' },
    ]);
    expect(offerings).toEqual([
      { providerId: 'chutes', baseSlug: 'deepseek-ai/DeepSeek-V3.2-TEE', teeVariant: true },
      { providerId: 'chutes', baseSlug: 'some/non-tee-model', teeVariant: false },
      { providerId: 'chutes', baseSlug: 'other/no-flag', teeVariant: false },
    ]);
  });
});
