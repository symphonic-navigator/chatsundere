// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WebInterfacingSection } from '../../src/components/WebInterfacingSection.js';
import type { WebBackendOption } from '../../src/lib/web-backend-options.js';

const brave: WebBackendOption = {
  providerId: 'nano-gpt',
  providerName: 'Nano-GPT',
  upstreamSlug: 'brave',
  label: 'Brave',
  canSearch: true,
  canFetch: true,
  traits: ['recommended'],
  requiresProxy: false,
};

describe('WebInterfacingSection', () => {
  it('renders a search and a fetch picker fed from the options', () => {
    render(
      <WebInterfacingSection options={[brave]} search={null} fetch={null} onChange={vi.fn()} />,
    );
    expect(screen.getByLabelText(/search backend/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/fetch backend/i)).toBeInTheDocument();
    // Friendly name with the upstream provider, and no abstract "Default" entry.
    expect(screen.getAllByText(/Brave \(Nano-GPT\)/).length).toBeGreaterThan(0);
    expect(screen.queryByText('Default')).not.toBeInTheDocument();
  });

  it('emits the chosen search backend as an OfferingRef', () => {
    const onChange = vi.fn();
    render(
      <WebInterfacingSection options={[brave]} search={null} fetch={null} onChange={onChange} />,
    );
    fireEvent.change(screen.getByLabelText(/search backend/i), {
      target: { value: 'nano-gpt::brave' },
    });
    expect(onChange).toHaveBeenCalledWith({
      search: { providerId: 'nano-gpt', upstreamSlug: 'brave' },
      fetch: null,
    });
  });
});
