// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import type { WebBackendOption } from '../../src/lib/web-backend-options.js';
import { resolveWebBackend } from '../../src/lib/web-backends.js';

const opt = (
  providerId: string,
  upstreamSlug: string,
  roles: { canSearch?: boolean; canFetch?: boolean },
): WebBackendOption => ({
  providerId,
  providerName: providerId,
  upstreamSlug,
  label: upstreamSlug,
  canSearch: roles.canSearch ?? false,
  canFetch: roles.canFetch ?? false,
  traits: [],
  requiresProxy: false,
});

const linkup = opt('nano-gpt', 'web-linkup', { canSearch: true });
const ollama = opt('ollama-cloud', 'web-ollama-search', { canSearch: true });

describe('resolveWebBackend', () => {
  it('off returns null', () => {
    expect(resolveWebBackend('off', [linkup], 'search')).toBeNull();
  });

  it('null defaults to the first usable option (first-come order preserved)', () => {
    expect(resolveWebBackend(null, [ollama, linkup], 'search')).toEqual({
      providerId: 'ollama-cloud',
      upstreamSlug: 'web-ollama-search',
    });
  });

  it('null with no usable option returns null', () => {
    expect(resolveWebBackend(null, [opt('x', 'y', { canFetch: true })], 'search')).toBeNull();
  });

  it('an explicit, still-usable ref resolves to itself', () => {
    expect(
      resolveWebBackend(
        { providerId: 'nano-gpt', upstreamSlug: 'web-linkup' },
        [ollama, linkup],
        'search',
      ),
    ).toEqual({ providerId: 'nano-gpt', upstreamSlug: 'web-linkup' });
  });

  it('an explicit ref whose backend is gone falls back to the next-best', () => {
    expect(
      resolveWebBackend({ providerId: 'nano-gpt', upstreamSlug: 'web-linkup' }, [ollama], 'search'),
    ).toEqual({ providerId: 'ollama-cloud', upstreamSlug: 'web-ollama-search' });
  });

  it('an explicit ref with nothing usable returns null', () => {
    expect(
      resolveWebBackend({ providerId: 'nano-gpt', upstreamSlug: 'web-linkup' }, [], 'search'),
    ).toBeNull();
  });
});
