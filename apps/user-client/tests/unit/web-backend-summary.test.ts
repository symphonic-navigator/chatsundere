// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { webBackendSummary } from '../../src/lib/web-backend-summary.js';

const searchOption = {
  providerId: 'linkup',
  providerName: 'Linkup',
  upstreamSlug: 'web-linkup',
  label: 'Linkup',
  canSearch: true,
  canFetch: false,
  traits: ['recommended'],
  requiresProxy: false,
};

const fetchOption = {
  providerId: 'nano-gpt',
  providerName: 'nano-gpt',
  upstreamSlug: 'web-scrape',
  label: 'Scrape',
  canSearch: false,
  canFetch: true,
  traits: [],
  requiresProxy: false,
};

const options = [searchOption, fetchOption] as never;

describe('webBackendSummary', () => {
  it('returns "Off" when both sides are off', () => {
    expect(webBackendSummary('off', 'off', options)).toBe('Off');
  });

  it('shows both names when both sides are set and resolve correctly', () => {
    expect(
      webBackendSummary(
        { providerId: 'linkup', upstreamSlug: 'web-linkup' },
        { providerId: 'nano-gpt', upstreamSlug: 'web-scrape' },
        options,
      ),
    ).toBe('Search: Linkup · Fetch: Scrape (nano-gpt)');
  });

  it('shows "Off" on the fetch side when fetch is explicitly off', () => {
    expect(
      webBackendSummary({ providerId: 'linkup', upstreamSlug: 'web-linkup' }, 'off', options),
    ).toBe('Search: Linkup · Fetch: Off');
  });

  it('resolves a stale explicit ref to "Off" when no options are available', () => {
    // resolveWebBackend falls back to the first usable option; with an empty list
    // there is no fallback, so the stale ref resolves to null → "Off".
    expect(
      webBackendSummary({ providerId: 'gone', upstreamSlug: 'web-gone' }, 'off', [] as never),
    ).toBe('Off');
  });
});
