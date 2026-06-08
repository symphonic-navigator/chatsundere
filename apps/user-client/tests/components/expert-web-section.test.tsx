// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ExpertWebSection } from '../../src/components/ExpertWebSection.js';

const options = [
  {
    providerId: 'nano-gpt',
    providerName: 'nano-gpt',
    upstreamSlug: 'web-exa',
    label: 'Exa',
    canSearch: true,
    canFetch: false,
    traits: ['neural'],
    requiresProxy: true,
  },
  {
    providerId: 'nano-gpt',
    providerName: 'nano-gpt',
    upstreamSlug: 'web-scrape',
    label: 'Scrape',
    canSearch: false,
    canFetch: true,
    traits: [],
    requiresProxy: true,
  },
] as never;

const tiers = [
  { id: 'quick', label: 'Quick', params: {} },
  { id: 'neural', label: 'Neural', params: { depth: 'neural' } },
] as never;

describe('ExpertWebSection', () => {
  it('renders search/fetch/depth pickers and emits a depth change', () => {
    const onChange = vi.fn();
    render(
      <ExpertWebSection
        options={options}
        value={{ search: null, fetch: null, searchTierId: null }}
        searchTiers={tiers}
        onChange={onChange}
      />,
    );
    expect(screen.getByLabelText(/search backend/i)).toBeTruthy();
    expect(screen.getByLabelText(/fetch backend/i)).toBeTruthy();
    const depth = screen.getByLabelText(/depth/i);
    expect(depth).toBeTruthy();
    fireEvent.change(depth, { target: { value: 'neural' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ searchTierId: 'neural' }));
  });

  it('disables the depth picker when there are no tiers', () => {
    render(
      <ExpertWebSection
        options={options}
        value={{ search: null, fetch: null, searchTierId: null }}
        searchTiers={[] as never}
        onChange={vi.fn()}
      />,
    );
    expect((screen.getByLabelText(/depth/i) as HTMLSelectElement).disabled).toBe(true);
  });
});
