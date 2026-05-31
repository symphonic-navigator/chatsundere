// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen, within } from '@testing-library/react';
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

import { AddProviderPicker } from '../../src/components/AddProviderPicker.js';

const noop = () => {};

describe('AddProviderPicker', () => {
  it('excludes already-configured providers', () => {
    render(
      <AddProviderPicker
        configuredTemplateIds={['chutes']}
        hasProxy={true}
        onPick={noop}
        onNeedProxy={noop}
        onClose={noop}
      />,
    );
    expect(screen.queryByText('Chutes')).not.toBeInTheDocument();
    expect(screen.getByText('Mistral AI')).toBeInTheDocument();
  });

  it('greys proxy-providers and offers a proxy shortcut when no proxy is set', () => {
    const onNeedProxy = vi.fn();
    render(
      <AddProviderPicker
        configuredTemplateIds={[]}
        hasProxy={false}
        onPick={noop}
        onNeedProxy={onNeedProxy}
        onClose={noop}
      />,
    );
    const wafer = screen.getByRole('button', { name: 'Wafer' });
    expect(wafer).toBeDisabled();
    expect(screen.getAllByText(/needs a cors proxy/i).length).toBeGreaterThan(0);
    // Two proxy-requiring providers each render a shortcut, so scope the click
    // to the Wafer entry's container to target its shortcut unambiguously.
    const waferEntry = wafer.parentElement as HTMLElement;
    fireEvent.click(within(waferEntry).getByRole('button', { name: /set up a cors proxy/i }));
    expect(onNeedProxy).toHaveBeenCalled();
  });

  it('enables proxy-providers when a proxy is set, and picks one', () => {
    const onPick = vi.fn();
    render(
      <AddProviderPicker
        configuredTemplateIds={[]}
        hasProxy={true}
        onPick={onPick}
        onNeedProxy={noop}
        onClose={noop}
      />,
    );
    const wafer = screen.getByRole('button', { name: 'Wafer' });
    expect(wafer).not.toBeDisabled();
    fireEvent.click(wafer);
    expect(onPick).toHaveBeenCalledWith('wafer');
  });
});
