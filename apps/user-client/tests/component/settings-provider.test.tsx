// SPDX-License-Identifier: AGPL-3.0-only
import { vi } from 'vitest';

// ─── Hoisted refs (available inside vi.mock factory closures) ─────────────────

const {
  getProviderMock,
  probeProviderMock,
  sealSecretMock,
  openSecretMock,
  upsertMock,
  settingsStore,
} = vi.hoisted(() => {
  // Mutated in beforeEach / per-test to drive the global-proxy branches.
  const settingsStore: { corsProxy: { url: string; sharedKey: unknown } | null } = {
    corsProxy: null,
  };
  return {
    getProviderMock: vi.fn((id: string) =>
      id === 'chutes'
        ? { displayName: 'Chutes', corsHint: 'direct', baseUrl: 'https://chutes.ai' }
        : undefined,
    ),
    probeProviderMock: vi.fn(),
    sealSecretMock: vi.fn(async (..._a: unknown[]) => ({ blob: 'sealed' })),
    openSecretMock: vi.fn(async (..._a: unknown[]) => 'decrypted-secret'),
    upsertMock: vi.fn(async (row: { id?: string }) => ({ id: row.id ?? 'r-new' })),
    settingsStore,
  };
});

// ─── Module mocks (hoisted before static imports by Vitest) ──────────────────

vi.mock('@chatsundere/llm-unified', () => ({
  MODALITY_ORDER: ['llm', 'web', 'tts', 'stt', 'tti'],
  getProvider: (id: string) => getProviderMock(id),
  providerServiceKinds: () => [],
  probeProvider: (args: unknown) => probeProviderMock(args),
}));

vi.mock('@chatsundere/ui-shared', () => ({
  useSessionStore: (selector: (s: { mk: CryptoKey }) => unknown) =>
    selector({ mk: {} as CryptoKey }),
}));

vi.mock('../../src/data/providers.js', () => ({
  useProviders: () => ({ data: [] }),
  useUpsertProvider: () => ({ mutateAsync: upsertMock }),
  useDeleteProvider: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock('../../src/data/settings.js', () => ({
  useSettings: () => ({ data: settingsStore }),
}));

vi.mock('../../src/content/help/use-help.js', () => ({
  useHelp: vi.fn(() => ({ onHelp: vi.fn(), helpOverlay: null })),
}));

vi.mock('../../src/lib/secrets.js', () => ({
  openSecret: (...a: unknown[]) => openSecretMock(...a),
  sealSecret: (...a: unknown[]) => sealSecretMock(...a),
}));

// ─── Imports (resolved after mocks are registered) ───────────────────────────

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { SettingsProviderPage } from '../../src/routes/app/settings/provider.js';

/**
 * Render the per-provider settings page at a given route path.
 * A stub `/app/settings/providers` route is included so that the
 * `back()` navigation after a successful save does not leave the
 * component tree in an undefined state.
 */
function wrapAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/app/settings/providers/:templateId" element={<SettingsProviderPage />} />
          <Route path="/app/settings/providers" element={<div>providers list</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('SettingsProviderPage', () => {
  beforeEach(() => {
    // Explicit unmount before each test: a prior test that triggers onSave can
    // leave React state pending past the global afterEach cleanup, which would
    // swallow the next test's click handler.
    cleanup();
    getProviderMock.mockImplementation((id: string) =>
      id === 'chutes'
        ? { displayName: 'Chutes', corsHint: 'direct', baseUrl: 'https://chutes.ai' }
        : undefined,
    );
    probeProviderMock.mockReset();
    sealSecretMock.mockImplementation(async (..._a: unknown[]) => ({ blob: 'sealed' }));
    openSecretMock.mockImplementation(async (..._a: unknown[]) => 'decrypted-secret');
    upsertMock.mockImplementation(async (row: { id?: string }) => ({ id: row.id ?? 'r-new' }));
    settingsStore.corsProxy = null;
  });

  // ── Existing render tests ─────────────────────────────────────────────────

  it('renders an API-key field and a Test & Save action for a known provider', async () => {
    wrapAt('/app/settings/providers/chutes');
    expect(await screen.findByLabelText(/API key/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /test & save/i })).toBeInTheDocument();
  });

  it('shows an unknown-provider notice for an unknown id', async () => {
    wrapAt('/app/settings/providers/not-a-provider');
    expect(await screen.findByText(/no longer available/i)).toBeInTheDocument();
  });

  // ── Ported seal/probe regression tests (from deleted provider-sheet.test.tsx) ──

  it('sets autocomplete=off and password-manager opt-out attrs on the API key field', async () => {
    wrapAt('/app/settings/providers/chutes');
    const input = await screen.findByLabelText(/api key/i);
    expect(input).toHaveAttribute('autocomplete', 'off');
    expect(input).toHaveAttribute('data-1p-ignore');
    expect(input).toHaveAttribute('data-lpignore', 'true');
  });

  it('blocks save for a requires-proxy provider when no global CORS proxy is set', async () => {
    settingsStore.corsProxy = null;
    getProviderMock.mockReturnValue({
      displayName: 'Ollama Cloud',
      baseUrl: 'https://ollama.com/v1',
      corsHint: 'requires-proxy',
    });
    wrapAt('/app/settings/providers/ollama-cloud');
    fireEvent.change(await screen.findByPlaceholderText('sk-...'), { target: { value: 'k' } });
    fireEvent.click(screen.getByRole('button', { name: /test & save/i }));
    expect(await screen.findByText(/set a cors proxy first/i)).toBeInTheDocument();
    expect(probeProviderMock).not.toHaveBeenCalled();
  });

  it('seals the api key and calls probeProvider with corsProxyUrl=null and corsProxyKey=null for a direct provider', async () => {
    probeProviderMock.mockResolvedValue({ ok: true, status: 200 });
    getProviderMock.mockReturnValue({
      displayName: 'Chutes',
      baseUrl: 'https://llm.chutes.ai/v1',
      corsHint: 'direct',
    });
    wrapAt('/app/settings/providers/chutes');
    fireEvent.change(await screen.findByPlaceholderText('sk-...'), {
      target: { value: 'sk-test-key' },
    });
    fireEvent.click(screen.getByRole('button', { name: /test & save/i }));
    await waitFor(() => expect(probeProviderMock).toHaveBeenCalledTimes(1));
    expect(sealSecretMock).toHaveBeenCalled();
    const arg = probeProviderMock.mock.calls[0]?.[0] as {
      corsProxyUrl: unknown;
      corsProxyKey: unknown;
    };
    expect(arg.corsProxyUrl).toBeNull();
    expect(arg.corsProxyKey).toBeNull();
    // Verify the successful probe causes an upsert with enabled: true.
    await waitFor(() =>
      expect(upsertMock).toHaveBeenCalledWith(expect.objectContaining({ enabled: true })),
    );
  });

  it('decrypts the shared proxy key and forwards corsProxyUrl + corsProxyKey to probeProvider for a requires-proxy provider', async () => {
    settingsStore.corsProxy = { url: 'https://proxy.test', sharedKey: { blob: 'sealed' } };
    probeProviderMock.mockResolvedValue({ ok: true, status: 200 });
    getProviderMock.mockReturnValue({
      displayName: 'Ollama Cloud',
      baseUrl: 'https://ollama.com/v1',
      corsHint: 'requires-proxy',
    });
    wrapAt('/app/settings/providers/ollama-cloud');
    fireEvent.change(await screen.findByPlaceholderText('sk-...'), {
      target: { value: 'sk-test-key' },
    });
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
