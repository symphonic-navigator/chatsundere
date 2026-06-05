// SPDX-License-Identifier: AGPL-3.0-only

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProviderSheet } from '../../src/components/ProviderSheet.js';

vi.mock('@chatsundere/llm-unified', () => ({
  getProvider: (id: string) => ({
    id,
    displayName: id === 'ollama-cloud' ? 'Ollama Cloud' : 'nano-gpt.com',
    baseUrl: 'https://example.com/v1',
    corsHint: id === 'ollama-cloud' ? 'requires-proxy' : 'inofficial',
    offerings: [],
  }),
  probeProvider: vi.fn(async () => ({ ok: true })),
}));

vi.mock('@chatsundere/ui-shared', () => ({
  useSessionStore: (selector: (s: { mk: Uint8Array }) => unknown) =>
    selector({ mk: new Uint8Array(32) }),
}));

vi.mock('../../src/lib/secrets.js', () => ({
  sealSecret: vi.fn(async () => ({ ciphertext: new Uint8Array(), iv: new Uint8Array() })),
  openSecret: vi.fn(async () => 'plain-key'),
}));

vi.mock('../../src/data/providers.js', () => ({
  useProviders: () => ({ data: [] }),
  useUpsertProvider: () => ({
    mutateAsync: vi.fn(async (row) => ({ id: 'pr-1', ...row })),
  }),
  useDeleteProvider: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock('../../src/data/settings.js', () => ({
  useSettings: () => ({ data: null }),
  useUpdateSettings: () => ({ mutateAsync: vi.fn() }),
}));

function renderSheet(templateId: 'nano-gpt' | 'ollama-cloud', onClose = () => {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ProviderSheet templateId={templateId} onClose={onClose} />
    </QueryClientProvider>,
  );
}

describe('ProviderSheet polish', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders an opaque backdrop with bg-ink classes', () => {
    const { container } = renderSheet('nano-gpt');
    const backdrop = container.querySelector('[data-ps-backdrop]');
    expect(backdrop).not.toBeNull();
    const sheet = container.querySelector('[data-ps-sheet]') as HTMLElement;
    expect(sheet.className).toMatch(/bg-ink/);
    expect(sheet.className).not.toMatch(/bg-bg\b/);
  });

  it('shows an explicit Save button', () => {
    renderSheet('nano-gpt');
    expect(screen.getByRole('button', { name: /save/i })).toBeInTheDocument();
  });

  it('does not run the probe when the close (×) button is clicked', async () => {
    const onClose = vi.fn();
    renderSheet('nano-gpt', onClose);
    fireEvent.click(screen.getByLabelText(/close/i));
    expect(onClose).toHaveBeenCalled();
    const probed = (await import('@chatsundere/llm-unified')).probeProvider as ReturnType<
      typeof vi.fn
    >;
    expect(probed).not.toHaveBeenCalled();
  });

  // The in-sheet proxy URL/shared-key fields were removed when the CORS proxy
  // became global (My Settings → CorsProxyBlock). Even a requires-proxy provider
  // shows no proxy field in the sheet.
  it('does not render in-sheet proxy fields (proxy is global now)', () => {
    renderSheet('ollama-cloud');
    expect(screen.queryByLabelText(/proxy url/i)).not.toBeInTheDocument();
  });

  it('sets autocomplete=off and password-manager opt-out attrs on the API key field', () => {
    renderSheet('nano-gpt');
    const input = screen.getByLabelText(/api key/i);
    expect(input).toHaveAttribute('autocomplete', 'off');
    expect(input).toHaveAttribute('data-1p-ignore');
    expect(input).toHaveAttribute('data-lpignore', 'true');
  });
});
