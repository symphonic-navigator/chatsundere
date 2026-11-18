// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
let gate: { enabled: boolean; reason: string | null; tooltip: string | null } = {
  enabled: false,
  reason: 'local-only',
  tooltip: GATE_TOOLTIP,
};
vi.mock('../../src/lib/server-gate.js', () => ({
  useServerGate: () => gate,
}));

import { AddProviderPicker } from '../../src/components/AddProviderPicker.js';

const noop = () => {};

function renderPicker(ui: React.ReactElement, url = '/app/settings/providers?return=/app') {
  return render(<MemoryRouter initialEntries={[url]}>{ui}</MemoryRouter>);
}

describe('AddProviderPicker', () => {
  beforeEach(() => {
    gate = { enabled: false, reason: 'local-only', tooltip: GATE_TOOLTIP };
  });

  it('offers ElevenLabs, the voice-only provider', () => {
    renderPicker(
      <AddProviderPicker configuredTemplateIds={[]} hasProxy={true} onPick={noop} onClose={noop} />,
    );
    expect(screen.getByText('ElevenLabs')).toBeInTheDocument();
  });

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

  it('groups gated providers at the end under one heading, with one server-linking link', () => {
    renderPicker(
      <AddProviderPicker
        configuredTemplateIds={[]}
        hasProxy={false}
        onPick={noop}
        onClose={noop}
      />,
    );
    const wafer = screen.getByRole('button', { name: 'Wafer' });
    const ollama = screen.getByRole('button', { name: 'Ollama Cloud' });
    expect(wafer).toBeDisabled();
    expect(ollama).toBeDisabled();
    expect(screen.queryByText(/cors proxy/i)).not.toBeInTheDocument();

    // Gated rows come after every available one, below the group heading.
    const buttons = screen
      .getAllByRole('button')
      .filter(
        (b) =>
          b.getAttribute('aria-label') !== 'Close' && b.getAttribute('aria-label') !== 'Dismiss',
      );
    const lastAvailable = buttons.filter((b) => !(b as HTMLButtonElement).disabled).pop();
    const heading = screen.getByRole('heading', { name: 'Need a linked server' });
    expect(lastAvailable?.compareDocumentPosition(heading)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(heading.compareDocumentPosition(wafer)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(heading.compareDocumentPosition(ollama)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);

    // The reason and its action appear once; each row keeps a short tag.
    const links = screen.getAllByRole('link', { name: /open server linking/i });
    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute('href')).toBe(
      `/app/account/server-linking?return=${encodeURIComponent('/app/settings/providers?return=/app')}`,
    );
    expect(wafer.textContent).toContain('Needs a linked server');
    expect(ollama.textContent).toContain('Needs a linked server');
  });

  it('offline: the heading says the server cannot be reached, with no server-linking link', () => {
    gate = { enabled: false, reason: 'offline', tooltip: 'offline tooltip' };
    renderPicker(
      <AddProviderPicker
        configuredTemplateIds={[]}
        hasProxy={false}
        onPick={noop}
        onClose={noop}
      />,
    );
    expect(
      screen.getByRole('heading', { name: "Your server can't be reached right now" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /open server linking/i })).toBeNull();
    expect(screen.getByRole('button', { name: 'Wafer' }).textContent).toContain(
      'Server unreachable',
    );
  });

  it('feature-missing: the heading says the server has no relay, with no link', () => {
    gate = { enabled: false, reason: 'feature-missing', tooltip: 'no relay tooltip' };
    renderPicker(
      <AddProviderPicker
        configuredTemplateIds={[]}
        hasProxy={false}
        onPick={noop}
        onClose={noop}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Your server has no relay' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /open server linking/i })).toBeNull();
  });

  it("any other reason: the heading is the gate's own tooltip, with no link", () => {
    gate = { enabled: false, reason: 'server-error', tooltip: 'Your server is answering oddly.' };
    renderPicker(
      <AddProviderPicker
        configuredTemplateIds={[]}
        hasProxy={false}
        onPick={noop}
        onClose={noop}
      />,
    );
    expect(
      screen.getByRole('heading', { name: 'Your server is answering oddly.' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /open server linking/i })).toBeNull();
  });

  it('shows no gated group when the relay is available', () => {
    gate = { enabled: true, reason: null, tooltip: null };
    renderPicker(
      <AddProviderPicker configuredTemplateIds={[]} hasProxy={true} onPick={noop} onClose={noop} />,
    );
    expect(screen.queryByRole('heading')).toBeNull();
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
