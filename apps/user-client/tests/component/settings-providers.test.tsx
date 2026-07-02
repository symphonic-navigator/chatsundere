// SPDX-License-Identifier: AGPL-3.0-only
import { vi } from 'vitest';

// ─── Module mocks (hoisted before static imports by Vitest) ───────────────────

// Mutable so individual tests can set a non-empty list without re-mocking.
let providerRows: Array<{ id: string; templateId: string; enabled: boolean; createdAt: number }> =
  [];
// Mutable so individual tests can drive the 'proxy' server-gate state.
let proxyGate: { enabled: boolean; reason: string | null; tooltip: string | null } = {
  enabled: true,
  reason: null,
  tooltip: null,
};

vi.mock('../../src/data/providers.js', () => ({ useProviders: () => ({ data: providerRows }) }));
vi.mock('../../src/lib/server-gate.js', () => ({ useServerGate: () => proxyGate }));
vi.mock('@chatsundere/ui-shared', () => ({
  useAccountLinkStore: (sel: (s: { issuerLabel: string | null }) => unknown) =>
    sel({ issuerLabel: null }),
}));
vi.mock('../../src/content/help/use-help.js', () => ({
  useHelp: vi.fn(() => ({ onHelp: vi.fn(), helpOverlay: null })),
}));
vi.mock('@chatsundere/llm-unified', () => ({
  MODALITY_ORDER: ['llm', 'web', 'tts', 'stt', 'tti'],
  getProvider: (id: string) => ({
    corsHint: id === 'wafer' ? 'requires-proxy' : 'direct',
    displayName: id,
    offerings: [{ serviceKind: 'llm' }],
    sortPriority: 10,
  }),
  providerServiceKinds: () => ['llm'],
  aggregateServiceKinds: (ids: string[]) => (ids.length ? ['llm'] : []),
  providersContributing: () => [],
}));

// ─── Imports (resolved after mocks are registered) ────────────────────────────

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it } from 'vitest';
import { SettingsProvidersPage } from '../../src/routes/app/settings/providers.js';

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('SettingsProvidersPage', () => {
  beforeEach(() => {
    providerRows = [];
    proxyGate = { enabled: true, reason: null, tooltip: null };
  });

  it('shows the empty-Circle copy and an add-provider control when no providers', async () => {
    wrap(<SettingsProvidersPage />);
    expect(await screen.findByText(/add a provider to begin/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add provider/i })).toBeInTheDocument();
  });

  it('lists only configured providers (not all built-ins)', () => {
    providerRows = [{ id: 'r1', templateId: 'chutes', enabled: true, createdAt: 0 }];
    wrap(<SettingsProvidersPage />);
    // Configured provider appears by its templateId (mock displayName = templateId).
    expect(screen.getByText('chutes')).toBeInTheDocument();
    // No unconfigured built-in leaks into the list.
    expect(screen.queryByText('OpenRouter')).not.toBeInTheDocument();
  });

  it('never renders the retired "CORS proxy" vocabulary', () => {
    wrap(<SettingsProvidersPage />);
    expect(screen.queryByText(/cors proxy/i)).not.toBeInTheDocument();
  });

  it('maps the disabled proxy-gate reason into a requires-proxy provider status', () => {
    providerRows = [{ id: 'r1', templateId: 'wafer', enabled: true, createdAt: 0 }];
    proxyGate = { enabled: false, reason: 'local-only', tooltip: 'Link a server first' };
    wrap(<SettingsProvidersPage />);
    expect(screen.getByText('✗ Needs a linked account')).toBeInTheDocument();
  });

  it('shows a requires-proxy provider as connected when the proxy gate is enabled', () => {
    providerRows = [{ id: 'r1', templateId: 'wafer', enabled: true, createdAt: 0 }];
    proxyGate = { enabled: true, reason: null, tooltip: null };
    wrap(<SettingsProvidersPage />);
    expect(screen.getByText('● Connected')).toBeInTheDocument();
  });
});
