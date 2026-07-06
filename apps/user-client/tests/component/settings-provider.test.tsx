// SPDX-License-Identifier: AGPL-3.0-only
import { vi } from 'vitest';

// ─── Hoisted refs (available inside vi.mock factory closures) ─────────────────

const {
  getProviderMock,
  probeProviderMock,
  sealSecretMock,
  openSecretMock,
  upsertMock,
  proxyGate,
} = vi.hoisted(() => {
  // Mutated in beforeEach / per-test to drive the proxy-gate branches.
  const proxyGate: { enabled: boolean; reason: string | null; tooltip: string | null } = {
    enabled: true,
    reason: null,
    tooltip: null,
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
    proxyGate,
  };
});

// ─── Module mocks (hoisted before static imports by Vitest) ──────────────────

vi.mock('@chatsundere/llm-unified', () => ({
  MODALITY_ORDER: ['llm', 'web', 'tts', 'stt', 'tti'],
  getProvider: (id: string) => getProviderMock(id),
  providerServiceKinds: () => [],
  probeProvider: (args: unknown) => probeProviderMock(args),
  getProxyAuthSource: () => ({
    getUrl: () => 'https://proxy.test',
    getToken: () => 'jwt',
    refreshToken: async () => null,
  }),
}));

vi.mock('@chatsundere/ui-shared', () => ({
  useSessionStore: (selector: (s: { mk: CryptoKey }) => unknown) =>
    selector({ mk: {} as CryptoKey }),
  // The Class-2 sync gate (Remove provider) reads the link status directly;
  // local-only means the affordance is never gated for these provider tests.
  useAccountLinkStore: (selector: (s: { linkStatus: string }) => unknown) =>
    selector({ linkStatus: 'local-only' }),
}));

vi.mock('../../src/data/providers.js', () => ({
  useProviders: () => ({ data: [] }),
  useUpsertProvider: () => ({ mutateAsync: upsertMock }),
  useDeleteProvider: () => ({ mutateAsync: vi.fn() }),
  providerApiKeySlot: (row: { id: string; keySlot?: string }) =>
    `provider/${row.keySlot ?? row.id}/api-key`,
}));

// `onSave` reads the stored row fresh from the DB (rather than trusting the
// cached `useProviders` list) to derive the seal slot — see Larissa M-1. No row
// is ever stored in these tests, mirroring the always-empty `useProviders` mock.
vi.mock('../../src/boot/client-data-db.js', () => ({
  getClientDataDb: () => ({
    providers: { get: async (_id: string) => undefined },
  }),
}));

vi.mock('../../src/lib/server-gate.js', () => ({
  useServerGate: () => proxyGate,
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
    proxyGate.enabled = true;
    proxyGate.reason = null;
    proxyGate.tooltip = null;
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

  it('blocks save for a requires-proxy provider when the account relay is unavailable', async () => {
    proxyGate.enabled = false;
    proxyGate.reason = 'local-only';
    proxyGate.tooltip = 'Link a server to relay this provider';
    getProviderMock.mockReturnValue({
      displayName: 'Ollama Cloud',
      baseUrl: 'https://ollama.com/v1',
      corsHint: 'requires-proxy',
    });
    wrapAt('/app/settings/providers/ollama-cloud');
    fireEvent.change(await screen.findByPlaceholderText('sk-...'), { target: { value: 'k' } });
    fireEvent.click(screen.getByRole('button', { name: /test & save/i }));
    expect(await screen.findByText(/link a server to relay this provider/i)).toBeInTheDocument();
    expect(probeProviderMock).not.toHaveBeenCalled();
  });

  it('seals the api key and calls probeProvider without any proxy fields for a direct provider', async () => {
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
    const arg = probeProviderMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(arg).not.toHaveProperty('corsProxyUrl');
    expect(arg).not.toHaveProperty('corsProxyKey');
    // Verify the successful probe causes an upsert with enabled: true.
    await waitFor(() =>
      expect(upsertMock).toHaveBeenCalledWith(expect.objectContaining({ enabled: true })),
    );
  });

  it('probes a requires-proxy provider (no proxy key threading) when the relay is available', async () => {
    proxyGate.enabled = true;
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
    const arg = probeProviderMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(arg).not.toHaveProperty('corsProxyUrl');
    expect(arg).not.toHaveProperty('corsProxyKey');
    expect(arg.config).toMatchObject({ routing: { kind: 'cors-proxy' } });
  });

  it('shows a passive Unsaved badge once an API key is typed', async () => {
    wrapAt('/app/settings/providers/chutes');
    fireEvent.change(await screen.findByPlaceholderText('sk-...'), { target: { value: 'k' } });
    expect(screen.getByText(/unsaved/i)).toBeInTheDocument();
  });

  it('guards Back with a discard confirm when an API key is unsaved', async () => {
    wrapAt('/app/settings/providers/chutes');
    fireEvent.change(await screen.findByPlaceholderText('sk-...'), { target: { value: 'k' } });
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText(/discard unsaved changes/i)).toBeInTheDocument();
    expect(screen.queryByText('providers list')).not.toBeInTheDocument();
  });
});
