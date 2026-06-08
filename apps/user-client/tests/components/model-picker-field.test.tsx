// SPDX-License-Identifier: AGPL-3.0-only

import { listOfferings } from '@chatsundere/llm-unified';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { ProviderRow } from '../../src/boot/client-data-db.js';
import { ModelPickerField } from '../../src/components/ModelPickerField.js';

afterEach(cleanup);

function providerRow(id: string, templateId: string): ProviderRow {
  return { id, templateId, enabled: true } as unknown as ProviderRow;
}

// A real Mistral deployment of the Mistral Large 3 canonical — used to build a
// selection that is valid (provider configured) or stale (provider absent).
const mistralOffer = listOfferings('mistral-large-3').find((o) => o.providerId === 'mistral');

describe('ModelPickerField trigger', () => {
  it('shows the empty label when nothing is selected', () => {
    render(
      <ModelPickerField
        providers={[]}
        configuredTemplateIds={[]}
        current={null}
        onSelect={() => {}}
        emptyLabel="Choose a model"
      />,
    );
    expect(screen.getByText('Choose a model')).toBeInTheDocument();
  });

  it('summarises a valid selection as "<model> · <provider>"', () => {
    expect(mistralOffer).toBeDefined();
    render(
      <ModelPickerField
        providers={[providerRow('pr-mistral', 'mistral')]}
        configuredTemplateIds={['mistral']}
        current={{ providerTemplateId: 'mistral', upstreamSlug: mistralOffer?.upstreamSlug ?? '' }}
        onSelect={() => {}}
        emptyLabel="Choose a model"
      />,
    );
    expect(screen.getByText(/Mistral Large 3/)).toBeInTheDocument();
    expect(screen.getByText(/Mistral AI/)).toBeInTheDocument();
  });

  it('shows a constructive stale state naming a provider to add when the selection is unreachable', () => {
    // The model exists in the catalogue but no provider serving it is configured.
    expect(mistralOffer).toBeDefined();
    render(
      <ModelPickerField
        providers={[]}
        configuredTemplateIds={[]}
        current={{ providerTemplateId: 'mistral', upstreamSlug: mistralOffer?.upstreamSlug ?? '' }}
        onSelect={() => {}}
        emptyLabel="Choose a model"
      />,
    );
    expect(screen.getByText(/currently unavailable/i)).toBeInTheDocument();
    expect(screen.getByText(/add Mistral/i)).toBeInTheDocument();
  });
});
