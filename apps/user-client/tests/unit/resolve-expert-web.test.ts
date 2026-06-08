// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { pickExpertSearchRef } from '../../src/lib/resolve-expert-web.js';

const options = [
  {
    providerId: 'nano-gpt',
    upstreamSlug: 'web-exa',
    canSearch: true,
    canFetch: false,
    traits: ['neural'],
    providerName: 'nano-gpt',
    label: 'Exa',
    requiresProxy: true,
  },
  {
    providerId: 'nano-gpt',
    upstreamSlug: 'web-linkup',
    canSearch: true,
    canFetch: false,
    traits: ['recommended'],
    providerName: 'nano-gpt',
    label: 'Linkup',
    requiresProxy: true,
  },
] as const;

describe('pickExpertSearchRef', () => {
  it('prefers exa when the search setting is auto (null) and exa resolves', () => {
    const r = pickExpertSearchRef(null, options as never);
    expect(r?.upstreamSlug).toBe('web-exa');
  });
  it('honours an explicit backend pick', () => {
    const r = pickExpertSearchRef(
      { providerId: 'nano-gpt', upstreamSlug: 'web-linkup' },
      options as never,
    );
    expect(r?.upstreamSlug).toBe('web-linkup');
  });
  it("returns null for an explicit 'off'", () => {
    expect(pickExpertSearchRef('off', options as never)).toBeNull();
  });
});
