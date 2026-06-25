// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WebPickerOverlay } from '../../src/components/WebPickerOverlay.js';
import type { WebBackendOption } from '../../src/lib/web-backend-options.js';

const OPTIONS: WebBackendOption[] = [
  {
    providerId: 'p1',
    providerName: 'nano-gpt',
    upstreamSlug: 'web-brave-search',
    label: 'Brave',
    canSearch: true,
    canFetch: false,
    traits: ['recommended'],
    requiresProxy: false,
  },
  {
    providerId: 'p1',
    providerName: 'nano-gpt',
    upstreamSlug: 'web-fetch',
    label: 'nano-gpt',
    canSearch: false,
    canFetch: true,
    traits: [],
    requiresProxy: false,
  },
];

function setup(over: Partial<React.ComponentProps<typeof WebPickerOverlay>> = {}) {
  const onSave = vi.fn();
  const result = render(
    <WebPickerOverlay
      open
      onClose={vi.fn()}
      title="Web search"
      mode="general"
      options={OPTIONS}
      searchTiers={[]}
      initial={{ search: null, fetch: null, searchTierId: null }}
      onSave={onSave}
      {...over}
    />,
  );
  return { onSave, rerender: result.rerender };
}

describe('WebPickerOverlay', () => {
  it('general mode shows search + fetch (no depth), with an Off option each', () => {
    setup();
    expect(screen.getByLabelText('Search backend')).toBeInTheDocument();
    expect(screen.getByLabelText('Fetch backend')).toBeInTheDocument();
    expect(screen.queryByLabelText('Search depth')).toBeNull();
    // "Off" present as a selectable option in the search select
    const search = screen.getByLabelText('Search backend') as HTMLSelectElement;
    expect([...search.options].some((o) => o.text === 'Off')).toBe(true);
  });

  it('expert mode adds the depth field', () => {
    setup({
      mode: 'expert',
      title: 'Expert web',
      searchTiers: [{ id: 'neural', label: 'Neural' } as never],
    });
    expect(screen.getByLabelText('Search depth')).toBeInTheDocument();
  });

  it('Save is dirty-gated and commits the staged value', () => {
    const { onSave } = setup();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Search backend'), { target: { value: '' } }); // → Off
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith({ search: 'off', fetch: null, searchTierId: null });
  });

  it('a new `initial` object with identical values does not clobber a staged change', () => {
    // Stage a change (Brave search), then re-render with a fresh `initial` identity
    // whose *values* are the same — the draft must survive.
    const { onSave, rerender } = setup();
    fireEvent.change(screen.getByLabelText('Search backend'), {
      target: { value: 'p1::web-brave-search' },
    });
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();

    // Fresh object reference, same values as the initial passed to setup().
    const sameValueNewIdentity = { search: null, fetch: null, searchTierId: null };
    rerender(
      <WebPickerOverlay
        open
        onClose={vi.fn()}
        title="Web search"
        mode="general"
        options={OPTIONS}
        searchTiers={[]}
        initial={sameValueNewIdentity}
        onSave={onSave}
      />,
    );

    // Save should still be enabled — staged Brave selection was not clobbered.
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith({
      search: { providerId: 'p1', upstreamSlug: 'web-brave-search' },
      fetch: null,
      searchTierId: null,
    });
  });
});
