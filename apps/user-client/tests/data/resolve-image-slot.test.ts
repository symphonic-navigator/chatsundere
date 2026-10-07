// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { buildImageSlot } from '../../src/data/resolve-image-slot.js';

describe('buildImageSlot', () => {
  it('upgrades a legacy Z-Image Base slot to the new ref and a valid config', () => {
    const r = buildImageSlot({
      ref: 'nano-gpt:z-image-turbo',
      config: { groupId: 'zimage', variant: 'base', size: '512x512' },
    });
    expect(r?.slot.ref).toBe('nano-gpt:z-image-base');
    expect(r?.slot.config).toEqual({ aspect: '1:1', resolution: null, quality: null });
    expect(r?.templateId).toBe('nano-gpt');
    expect(r?.slug).toBe('z-image-base');
  });

  it('reads maxCount from the descriptor (FLUX.3 → 4)', () => {
    const r = buildImageSlot({
      ref: 'nano-gpt:black-forest-labs/flux-3/text-to-image',
      config: { aspect: '1:1', resolution: '4k', quality: null },
    });
    expect(r?.slot.maxCount).toBe(4);
    expect(r?.meta.maxCount).toBe(4);
  });

  it('returns null for junk and for retired offerings', () => {
    expect(buildImageSlot(null)).toBeNull();
    expect(buildImageSlot({ ref: 'nano-gpt:no-such-model', config: {} })).toBeNull();
  });
});
