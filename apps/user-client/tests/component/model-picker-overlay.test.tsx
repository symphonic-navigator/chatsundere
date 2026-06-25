// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ModelPickerOverlay } from '../../src/components/ModelPickerOverlay.js';
import * as data from '../../src/components/model-picker/model-picker-data.js';

const MODEL = {
  canonical: { id: 'c1', displayName: 'Fable 5', family: 'Fable', freedomOriented: true },
  offers: [
    {
      offering: {
        providerId: 'p1',
        upstreamSlug: 'fable-5',
        trust: { tee: false, zdr: false, jurisdiction: undefined },
        context: { recommended: 200000 },
        profile: { vision: true, toolCalls: { supported: true } },
        freedomOrientedDeployment: true,
        canonicalRef: 'c1',
      },
      providerRowId: 'r1',
      providerDisplayName: 'nano-gpt',
    },
  ],
  teeAvailable: false,
  zdrAvailable: false,
  sortPriority: 0,
} as unknown as data.PickerModel;

function stubData(groups: data.FamilyGroup[], hiddenCount = 0) {
  vi.spyOn(data, 'buildPickerData').mockReturnValue({ groups, hiddenCount });
  vi.spyOn(data, 'filterGroupsByQuery').mockImplementation((g) => g);
}

describe('ModelPickerOverlay', () => {
  afterEach(() => vi.restoreAllMocks());

  it('drills model → provider, ‹ returns to models, picking a provider commits and closes; no Save', () => {
    stubData([{ family: 'Fable', models: [MODEL], sortPriority: 0 }]);
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(
      <ModelPickerOverlay
        open
        onClose={onClose}
        onSelect={onSelect}
        providers={[]}
        configuredTemplateIds={[]}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Fable 5/ }));
    // provider step
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onClose).not.toHaveBeenCalled(); // ‹ stepped back, not closed
    fireEvent.click(screen.getByRole('button', { name: /Fable 5/ }));
    fireEvent.click(screen.getByRole('button', { name: /nano-gpt/ }));
    expect(onSelect).toHaveBeenCalledWith({
      canonicalId: 'c1',
      providerTemplateId: 'p1',
      providerRowId: 'r1',
      upstreamSlug: 'fable-5',
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('vision-locked empty list names the constraint', () => {
    stubData([], 2);
    render(
      <ModelPickerOverlay
        open
        onClose={vi.fn()}
        onSelect={vi.fn()}
        providers={[]}
        configuredTemplateIds={[]}
        filter="vision"
      />,
    );
    expect(screen.getByText(/image-capable models/i)).toBeInTheDocument();
  });
});
