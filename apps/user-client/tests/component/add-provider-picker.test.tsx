// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@chatsundere/llm-unified', () => ({
  MODALITY_ORDER: ['llm', 'web', 'tts', 'stt', 'tti'],
  getProvider: (id: string) => ({
    corsHint: id === 'wafer' || id === 'ollama-cloud' ? 'requires-proxy' : 'direct',
    offerings: [{ serviceKind: 'llm', freedomOrientedDeployment: id === 'chutes' }],
    sortPriority: id === 'chutes' ? 10 : 50,
  }),
  providerServiceKinds: () => ['llm'],
}));

const GATE_TOOLTIP = 'Link a server to route this provider.';
vi.mock('../../src/lib/server-gate.js', () => ({
  useServerGate: () => ({ enabled: false, reason: 'local-only', tooltip: GATE_TOOLTIP }),
}));

import { AddProviderPicker } from '../../src/components/AddProviderPicker.js';

const noop = () => {};

function renderPicker(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe('AddProviderPicker', () => {
  it('excludes already-configured providers', () => {
    renderPicker(
      <AddProviderPicker
        configuredTemplateIds={['chutes']}
        hasProxy={true}
        onPick={noop}
        onClose={noop}
      />,
    );
    expect(screen.queryByText('Chutes')).not.toBeInTheDocument();
    expect(screen.getByText('Mistral AI')).toBeInTheDocument();
  });

  it('greys proxy-providers, shows the gate tooltip, and links to server linking', () => {
    renderPicker(
      <AddProviderPicker
        configuredTemplateIds={[]}
        hasProxy={false}
        onPick={noop}
        onClose={noop}
      />,
    );
    const wafer = screen.getByRole('button', { name: 'Wafer' });
    expect(wafer).toBeDisabled();
    // The retired "CORS proxy" copy is gone; the honest gate tooltip stands in.
    expect(screen.queryByText(/cors proxy/i)).not.toBeInTheDocument();
    expect(screen.getAllByText(GATE_TOOLTIP).length).toBeGreaterThan(0);
    const links = screen.getAllByRole('link', { name: /open server linking/i });
    expect(links.length).toBeGreaterThan(0);
    // biome-ignore lint/style/noNonNullAssertion: getAllByRole returns a non-empty array here
    expect(links[0]!.getAttribute('href')).toBe('/app/account/server-linking');
  });

  it('enables proxy-providers when a proxy is set, and picks one', () => {
    const onPick = vi.fn();
    renderPicker(
      <AddProviderPicker
        configuredTemplateIds={[]}
        hasProxy={true}
        onPick={onPick}
        onClose={noop}
      />,
    );
    const wafer = screen.getByRole('button', { name: 'Wafer' });
    expect(wafer).not.toBeDisabled();
    fireEvent.click(wafer);
    expect(onPick).toHaveBeenCalledWith('wafer');
  });
});
