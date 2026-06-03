import { describe, expect, it } from 'vitest';
// SPDX-License-Identifier: AGPL-3.0-only
import type { WebBackendOption } from '../../src/lib/web-backend-options.js';
import { type WebBackendSetting, resolveWebBackend } from '../../src/lib/web-backends.js';

const opt = (slug: string, canSearch = true): WebBackendOption => ({
  providerId: 'nano-gpt',
  providerName: 'nano-gpt',
  upstreamSlug: slug,
  label: slug,
  canSearch,
  canFetch: !canSearch,
  traits: [],
  requiresProxy: true,
});

const search = [opt('web-linkup'), opt('web-exa')];

describe('resolveWebBackend', () => {
  it('unset (null) → the recommended default (first option) when available', () => {
    expect(resolveWebBackend(null, search, 'search')).toEqual({
      providerId: 'nano-gpt',
      upstreamSlug: 'web-linkup',
    });
  });
  it("explicit 'off' → null", () => {
    expect(resolveWebBackend('off', search, 'search')).toBeNull();
  });
  it('an explicit ref → itself when still available', () => {
    const ref = { providerId: 'nano-gpt', upstreamSlug: 'web-exa' };
    expect(resolveWebBackend(ref, search, 'search')).toEqual(ref);
  });
  it('an explicit ref → null when no longer available', () => {
    const ref = { providerId: 'nano-gpt', upstreamSlug: 'web-gone' };
    expect(resolveWebBackend(ref, search, 'search')).toBeNull();
  });
  it('unset with no options → null', () => {
    expect(resolveWebBackend(null, [], 'search')).toBeNull();
  });
});
