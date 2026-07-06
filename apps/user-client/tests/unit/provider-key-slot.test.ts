// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { providerApiKeySlot } from '../../src/data/providers.js';

describe('providerApiKeySlot', () => {
  it('uses keySlot when present', () => {
    expect(providerApiKeySlot({ id: 'nano-gpt', keySlot: 'old-uuid' })).toBe(
      'provider/old-uuid/api-key',
    );
  });
  it('falls back to id when keySlot is absent (pre-v35 row)', () => {
    expect(providerApiKeySlot({ id: 'old-uuid' })).toBe('provider/old-uuid/api-key');
  });
});
