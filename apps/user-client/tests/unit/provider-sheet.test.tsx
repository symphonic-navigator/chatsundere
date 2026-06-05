// SPDX-License-Identifier: AGPL-3.0-only

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const getProviderMock = vi.fn();
const probeProviderMock = vi.fn();
const sealSecretMock = vi.fn(async (..._a: unknown[]) => ({ blob: 'sealed' }));
const openSecretMock = vi.fn(async (..._a: unknown[]) => 'decrypted-secret');
const upsertMock = vi.fn(async (row: { id?: string }) => ({ id: row.id ?? 'r-new' }));

// Settings singleton — mutated per-test to drive the global-proxy branches.
let settingsData: { corsProxy: { url: string; sharedKey: unknown } | null } = { corsProxy: null };

vi.mock('@chatsundere/llm-unified', () => ({
  getProvider: (id: string) => getProviderMock(id),
  probeProvider: (args: unknown) => probeProviderMock(args),
}));
vi.mock('@chatsundere/ui-shared', () => ({
  useSessionStore: (sel: (s: { mk: unknown }) => unknown) => sel({ mk: {} as CryptoKey }),
}));
vi.mock('../../src/data/providers.js', () => ({
  useProviders: () => ({ data: [] }),
  useUpsertProvider: () => ({ mutateAsync: upsertMock }),
  useDeleteProvider: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('../../src/data/settings.js', () => ({
  useSettings: () => ({ data: settingsData }),
}));
vi.mock('../../src/lib/secrets.js', () => ({
  sealSecret: (...a: unknown[]) => sealSecretMock(...a),
  openSecret: (...a: unknown[]) => openSecretMock(...a),
}));

import { ProviderSheet } from '../../src/components/ProviderSheet.js';

function renderSheet(templateId: string) {
  // The component's Props.templateId is a literal union; the cast keeps the
  // test ergonomic without widening the production type.
  return render(<ProviderSheet templateId={templateId as 'chutes'} onClose={() => {}} />);
}

describe('ProviderSheet', () => {
  beforeEach(() => {
    // Explicit unmount: a prior test that triggers onSave can leave React
    // state pending past the global afterEach cleanup, which otherwise
    // swallows the next test's click handler.
    cleanup();
    getProviderMock.mockReset();
    probeProviderMock.mockReset();
    sealSecretMock.mockClear();
    openSecretMock.mockClear();
    upsertMock.mockClear();
    settingsData = { corsProxy: null };
  });

  it('renders only the API key field for direct-CORS providers', () => {
    getProviderMock.mockReturnValue({
      displayName: 'nano-gpt',
      baseUrl: 'https://nano-gpt.com/api/v1',
      corsHint: 'direct',
    });
    renderSheet('nano-gpt');
    expect(screen.getByPlaceholderText(/sk-/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/proxy url/i)).not.toBeInTheDocument();
  });

  it('does not render proxy fields (proxy is global now)', () => {
    getProviderMock.mockReturnValue({
      displayName: 'Ollama Cloud',
      baseUrl: 'https://ollama.com/v1',
      corsHint: 'requires-proxy',
    });
    renderSheet('ollama-cloud');
    expect(screen.queryByLabelText(/proxy url/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/shared key/i)).not.toBeInTheDocument();
  });

  it('calls onClose immediately when the × button is clicked without saving', async () => {
    getProviderMock.mockReturnValue({
      displayName: 'nano-gpt',
      baseUrl: 'https://nano-gpt.com/api/v1',
      corsHint: 'direct',
    });
    const onClose = vi.fn();
    render(<ProviderSheet templateId="nano-gpt" onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /^close$/i }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(probeProviderMock).not.toHaveBeenCalled();
  });

  it('blocks save for a proxy-provider when no global proxy is set', async () => {
    settingsData = { corsProxy: null };
    getProviderMock.mockReturnValue({
      displayName: 'Ollama Cloud',
      baseUrl: 'https://ollama.com/v1',
      corsHint: 'requires-proxy',
    });
    renderSheet('ollama-cloud');
    fireEvent.change(screen.getByPlaceholderText('sk-...'), { target: { value: 'k' } });
    fireEvent.click(screen.getByRole('button', { name: /test & save/i }));
    expect(await screen.findByText(/set a cors proxy first/i)).toBeInTheDocument();
    expect(probeProviderMock).not.toHaveBeenCalled();
  });

  it('seals the api key and probes on save for a direct provider, flashing the unlocked modality', async () => {
    probeProviderMock.mockResolvedValue({ ok: true, status: 200 });
    getProviderMock.mockReturnValue({
      displayName: 'Chutes',
      baseUrl: 'https://llm.chutes.ai/v1',
      corsHint: 'direct',
    });
    render(<ProviderSheet templateId="chutes" onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText('sk-...'), { target: { value: 'sk-test-key' } });
    fireEvent.click(screen.getByRole('button', { name: /test & save/i }));
    await waitFor(() => expect(probeProviderMock).toHaveBeenCalledTimes(1));
    expect(sealSecretMock).toHaveBeenCalled();
    const arg = probeProviderMock.mock.calls[0]?.[0] as {
      corsProxyUrl: unknown;
      corsProxyKey: unknown;
    };
    expect(arg.corsProxyUrl).toBeNull();
    expect(arg.corsProxyKey).toBeNull();
    expect(await screen.findByText(/llm unlocked/i)).toBeInTheDocument();
  });

  it('reads the existing global proxy for a requires-proxy probe', async () => {
    settingsData = { corsProxy: { url: 'https://proxy.test', sharedKey: { blob: 'sealed' } } };
    probeProviderMock.mockResolvedValue({ ok: true, status: 200 });
    getProviderMock.mockReturnValue({
      displayName: 'Ollama Cloud',
      baseUrl: 'https://ollama.com/v1',
      corsHint: 'requires-proxy',
    });
    render(<ProviderSheet templateId="ollama-cloud" onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText('sk-...'), { target: { value: 'sk-test-key' } });
    fireEvent.click(screen.getByRole('button', { name: /test & save/i }));
    await waitFor(() => expect(probeProviderMock).toHaveBeenCalledTimes(1));
    const arg = probeProviderMock.mock.calls[0]?.[0] as {
      corsProxyUrl: unknown;
      corsProxyKey: unknown;
    };
    expect(arg.corsProxyUrl).toBe('https://proxy.test');
    expect(arg.corsProxyKey).toBe('decrypted-secret');
  });
});
