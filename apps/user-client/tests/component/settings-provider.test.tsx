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
  providerRows,
  session,
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
        ? {
            displayName: 'Chutes',
            corsHint: 'direct',
            capabilities: ['llm'],
            baseUrl: 'https://chutes.ai',
          }
        : undefined,
    ),
    probeProviderMock: vi.fn(),
    sealSecretMock: vi.fn(async (..._a: unknown[]) => ({ blob: 'sealed' })),
    openSecretMock: vi.fn(async (..._a: unknown[]) => 'decrypted-secret'),
    upsertMock: vi.fn(async (row: { id?: string }) => ({ id: row.id ?? 'r-new' })),
    proxyGate,
    // The session's master key; null drives the "needs your passphrase" branch.
    session: { mk: {} as unknown },
    // Rows seen by both useProviders and the fresh DB read in onSave.
    providerRows: [] as Array<{ id: string; templateId: string; apiKey: unknown }>,
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
  useSessionStore: (selector: (s: { mk: unknown }) => unknown) => selector({ mk: session.mk }),
  // The Class-2 sync gate (Remove provider) reads the link status directly;
  // local-only means the affordance is never gated for these provider tests.
  useAccountLinkStore: (selector: (s: { linkStatus: string }) => unknown) =>
    selector({ linkStatus: 'local-only' }),
}));

vi.mock('../../src/data/providers.js', () => ({
  useProviders: () => ({ data: providerRows }),
  useUpsertProvider: () => ({ mutateAsync: upsertMock }),
  useDeleteProvider: () => ({ mutateAsync: vi.fn() }),
  providerApiKeySlot: (row: { id: string; keySlot?: string }) =>
    `provider/${row.keySlot ?? row.id}/api-key`,
}));

// `onSave` reads the stored row fresh from the DB (rather than trusting the
// cached `useProviders` list) to derive the seal slot — see Larissa M-1. It
// reads the same `providerRows` the `useProviders` mock serves.
vi.mock('../../src/boot/client-data-db.js', () => ({
  getClientDataDb: () => ({
    providers: { get: async (id: string) => providerRows.find((r) => r.id === id) },
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
import { MemoryRouter, Route, Routes, useLocation, useParams } from 'react-router-dom';
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
          <Route path="/app/chat/:id" element={<ChatMarker />} />
          <Route path="/login" element={<LoginMarker />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Marker route standing in for a real chat page, so `?return=` navigation
 * back to a specific chat can be asserted without a full chat-page render. */
function ChatMarker(): JSX.Element {
  const { id } = useParams<{ id: string }>();
  return <div data-testid="chat-marker">{id}</div>;
}

/** Marker for the login page that records where it was asked to return to. */
function LoginMarker(): JSX.Element {
  const { search } = useLocation();
  return <div data-testid="login-marker" data-search={search} />;
}

describe('SettingsProviderPage', () => {
  beforeEach(() => {
    // Explicit unmount before each test: a prior test that triggers onSave can
    // leave React state pending past the global afterEach cleanup, which would
    // swallow the next test's click handler.
    cleanup();
    getProviderMock.mockImplementation((id: string) =>
      id === 'chutes'
        ? {
            displayName: 'Chutes',
            corsHint: 'direct',
            capabilities: ['llm'],
            baseUrl: 'https://chutes.ai',
          }
        : undefined,
    );
    probeProviderMock.mockReset();
    sealSecretMock.mockImplementation(async (..._a: unknown[]) => ({ blob: 'sealed' }));
    openSecretMock.mockImplementation(async (..._a: unknown[]) => 'decrypted-secret');
    upsertMock.mockClear();
    upsertMock.mockImplementation(async (row: { id?: string }) => ({ id: row.id ?? 'r-new' }));
    proxyGate.enabled = true;
    proxyGate.reason = null;
    proxyGate.tooltip = null;
    providerRows.length = 0;
    session.mk = {};
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
      capabilities: ['llm'],
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
      capabilities: ['llm'],
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
      capabilities: ['llm'],
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

  // ── `?return=` honouring (spec §3.3 — cockpit fallback repair trip) ───────────

  it('returns to the originating chat via a valid ?return=', async () => {
    wrapAt('/app/settings/providers/chutes?return=%2Fapp%2Fchat%2Fc1');
    fireEvent.click(await screen.findByRole('button', { name: 'Back' }));
    expect(await screen.findByTestId('chat-marker')).toHaveTextContent('c1');
  });

  it('falls back to the providers list for an open-redirect ?return=', async () => {
    wrapAt('/app/settings/providers/chutes?return=%2F%2Fevil.example');
    fireEvent.click(await screen.findByRole('button', { name: 'Back' }));
    expect(await screen.findByText('providers list')).toBeInTheDocument();
  });

  // ── A removed provider (apiKey: null) has no saved key (final-fix J) ─────────

  it('treats a removed provider row as having no saved key', async () => {
    providerRows.push({ id: 'chutes', templateId: 'chutes', apiKey: null });
    wrapAt('/app/settings/providers/chutes');
    expect(await screen.findByRole('button', { name: 'Test a model' })).toBeDisabled();
    expect(screen.getByText('Save a key first')).toBeInTheDocument();
  });

  it('asks for a key when saving an empty field on a removed provider row', async () => {
    providerRows.push({ id: 'chutes', templateId: 'chutes', apiKey: null });
    wrapAt('/app/settings/providers/chutes');
    fireEvent.click(await screen.findByRole('button', { name: /test & save/i }));
    expect(await screen.findByText('✗ API key required')).toBeInTheDocument();
    expect(upsertMock).not.toHaveBeenCalled();
    expect(probeProviderMock).not.toHaveBeenCalled();
  });

  it('enables model tests once a key is saved', async () => {
    providerRows.push({ id: 'chutes', templateId: 'chutes', apiKey: { blob: 'sealed' } });
    wrapAt('/app/settings/providers/chutes');
    expect(await screen.findByRole('button', { name: 'Test a model' })).toBeEnabled();
  });

  // ── Voice-only providers ──────────────────────────────────────────────────

  it('disables "Test a model" for a voice-only provider and says why', async () => {
    providerRows.push({ id: 'elevenlabs', templateId: 'elevenlabs', apiKey: { blob: 'k' } });
    getProviderMock.mockReturnValue({
      displayName: 'ElevenLabs',
      baseUrl: 'https://api.elevenlabs.io',
      corsHint: 'direct',
      capabilities: ['tts', 'stt'],
    });
    wrapAt('/app/settings/providers/elevenlabs');
    expect(await screen.findByRole('button', { name: /test a model/i })).toBeDisabled();
    expect(
      screen.getByText(
        "ElevenLabs offers voices only. Choose it under My Settings → Voice, then pick a voice on a persona's Font & Voice page.",
      ),
    ).toBeInTheDocument();
  });

  it('keeps "Test a model" enabled for an LLM provider', async () => {
    providerRows.push({ id: 'chutes', templateId: 'chutes', apiKey: { blob: 'k' } });
    getProviderMock.mockReturnValue({
      displayName: 'Chutes',
      baseUrl: 'https://llm.chutes.ai/v1',
      corsHint: 'direct',
      capabilities: ['llm'],
    });
    wrapAt('/app/settings/providers/chutes');
    expect(await screen.findByRole('button', { name: /test a model/i })).not.toBeDisabled();
  });

  it('reads "voices unlocked" for a voice-only provider and "LLM unlocked" for an LLM one', async () => {
    // The ok badge is transient (the page navigates back), so assert the copy via the helper.
    const { keyValidCopy } = await import('../../src/routes/app/settings/provider.js');
    expect(keyValidCopy(['tts', 'stt'])).toBe('✓ Key valid · voices unlocked');
    expect(keyValidCopy(['llm'])).toBe('✓ Key valid · LLM unlocked');
    expect(keyValidCopy(undefined)).toBe('✓ Key valid · LLM unlocked');
  });

  // ── Failed key test: cause + next step, raw detail kept smaller (item 6) ────

  it('maps a failed direct probe (status 0) to a cause and keeps the raw detail underneath', async () => {
    probeProviderMock.mockResolvedValue({ ok: false, status: 0, reason: 'Failed to fetch' });
    wrapAt('/app/settings/providers/chutes');
    fireEvent.change(await screen.findByPlaceholderText('sk-...'), { target: { value: 'k' } });
    fireEvent.click(screen.getByRole('button', { name: /test & save/i }));
    const status = await screen.findByTestId('sheet-status');
    await waitFor(() => expect(status.textContent).toContain("Couldn't reach Chutes."));
    expect(screen.getByTestId('sheet-status-detail').textContent).toBe('0 · Failed to fetch');
    expect(status.textContent).not.toContain('✗ 0 · Failed to fetch');
  });

  it('names the relay for a failed probe routed through the server', async () => {
    probeProviderMock.mockResolvedValue({ ok: false, status: 0, reason: 'Failed to fetch' });
    getProviderMock.mockReturnValue({
      displayName: 'Ollama Cloud',
      baseUrl: 'https://ollama.com/v1',
      corsHint: 'requires-proxy',
      capabilities: ['llm'],
    });
    wrapAt('/app/settings/providers/ollama-cloud');
    fireEvent.change(await screen.findByPlaceholderText('sk-...'), { target: { value: 'k' } });
    fireEvent.click(screen.getByRole('button', { name: /test & save/i }));
    expect(
      await screen.findByText(/couldn't reach ollama cloud through your server's relay/i),
    ).toBeInTheDocument();
  });

  it('says the key was not accepted on a 401', async () => {
    probeProviderMock.mockResolvedValue({ ok: false, status: 401, reason: 'Unauthorized' });
    wrapAt('/app/settings/providers/chutes');
    fireEvent.change(await screen.findByPlaceholderText('sk-...'), { target: { value: 'k' } });
    fireEvent.click(screen.getByRole('button', { name: /test & save/i }));
    expect(await screen.findByText(/chutes didn't accept this key/i)).toBeInTheDocument();
    expect(screen.getByTestId('sheet-status-detail').textContent).toBe('401 · Unauthorized');
  });

  it('maps an OperationError (a key sealed under an earlier master key) to "paste it again"', async () => {
    providerRows.push({ id: 'chutes', templateId: 'chutes', apiKey: { blob: 'old' } });
    openSecretMock.mockRejectedValue(
      Object.assign(new Error('The operation failed for an operation-specific reason'), {
        name: 'OperationError',
      }),
    );
    wrapAt('/app/settings/providers/chutes');
    fireEvent.click(await screen.findByRole('button', { name: /test & save/i }));
    expect(
      await screen.findByText(/the saved key can't be opened any more\. paste it again\./i),
    ).toBeInTheDocument();
    expect(screen.getByTestId('sheet-status').textContent).not.toContain('operation-specific');
  });

  it('without a master key, asks for the passphrase and links to the login page', async () => {
    session.mk = null;
    wrapAt('/app/settings/providers/chutes?return=%2Fapp%2Fchat%2Fc1');
    fireEvent.change(await screen.findByPlaceholderText('sk-...'), { target: { value: 'k' } });
    fireEvent.click(screen.getByRole('button', { name: /test & save/i }));
    expect(
      await screen.findByText(
        /chatsundere needs your passphrase once more before it can use your keys\./i,
      ),
    ).toBeInTheDocument();
    expect(probeProviderMock).not.toHaveBeenCalled();
    // The "dirty" guard asks before leaving with an unsaved key; clear it first.
    fireEvent.change(screen.getByPlaceholderText('sk-...'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('link', { name: 'Enter passphrase' }));
    const login = await screen.findByTestId('login-marker');
    expect(login.dataset.search).toBe(
      `?return=${encodeURIComponent('/app/settings/providers/chutes?return=%2Fapp%2Fchat%2Fc1')}&need=passphrase`,
    );
  });

  it('focuses the key field when opened with ?focus=key (from Re-enter key)', async () => {
    wrapAt('/app/settings/providers/chutes?return=%2Fapp%2Fchat%2Fc1&focus=key');
    const input = await screen.findByPlaceholderText('sk-...');
    await waitFor(() => expect(document.activeElement).toBe(input));
  });

  it('leaves focus alone without ?focus=key', async () => {
    wrapAt('/app/settings/providers/chutes');
    const input = await screen.findByPlaceholderText('sk-...');
    expect(document.activeElement).not.toBe(input);
  });
});
