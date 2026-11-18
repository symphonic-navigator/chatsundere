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

// Mutable persona list (undefined = still loading) and first-sync flag for the
// "Next: create your first companion" card.
let personaRows: Array<{ id: string }> | undefined = [];
let firstSyncPending = false;
// Mutable per-provider service kinds (default: every provider has a chat model).
let kindsOf: (id: string) => string[] = () => ['llm'];

vi.mock('../../src/data/providers.js', () => ({ useProviders: () => ({ data: providerRows }) }));
vi.mock('../../src/data/personas.js', () => ({ usePersonas: () => ({ data: personaRows }) }));
vi.mock('../../src/sync/first-sync.js', () => ({ useFirstSyncPending: () => firstSyncPending }));
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
  providerServiceKinds: (id: string) => kindsOf(id),
  aggregateServiceKinds: (ids: string[]) => (ids.length ? ['llm'] : []),
  providersContributing: () => [],
}));

// ─── Imports (resolved after mocks are registered) ────────────────────────────

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
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
    personaRows = [];
    firstSyncPending = false;
    kindsOf = () => ['llm'];
  });

  it('shows the empty-list copy (about providers, not voice) and an add-provider control', async () => {
    wrap(<SettingsProvidersPage />);
    expect(
      await screen.findByText('No AI providers yet. Add one so your companions can answer.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/no voice yet/i)).toBeNull();
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

function Where(): JSX.Element {
  const l = useLocation();
  return <div data-testid="where">{`${l.pathname}${l.search}`}</div>;
}

const NEXT = /next: create your first companion/i;

describe('SettingsProvidersPage — next step after a key', () => {
  beforeEach(() => {
    providerRows = [{ id: 'r1', templateId: 'chutes', enabled: true, createdAt: 0 }];
    proxyGate = { enabled: true, reason: null, tooltip: null };
    personaRows = [];
    firstSyncPending = false;
    kindsOf = () => ['llm'];
  });

  it('shows the card with a usable chat provider and no companion, and opens the new-companion form', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/app/settings/providers?return=/app']}>
          <Routes>
            <Route path="/app/settings/providers" element={<SettingsProvidersPage />} />
            <Route path="*" element={<Where />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole('link', { name: NEXT }));
    expect(screen.getByTestId('where').textContent).toBe('/app/persona/new');
  });

  it('is gone once a companion exists', () => {
    personaRows = [{ id: 'p1' }];
    wrap(<SettingsProvidersPage />);
    expect(screen.queryByRole('link', { name: NEXT })).toBeNull();
  });

  it('does not flash while the companions are still loading', () => {
    personaRows = undefined;
    wrap(<SettingsProvidersPage />);
    expect(screen.queryByRole('link', { name: NEXT })).toBeNull();
  });

  it('is not shown while a first sync is pending (no duplicate invitation)', () => {
    firstSyncPending = true;
    wrap(<SettingsProvidersPage />);
    expect(screen.queryByRole('link', { name: NEXT })).toBeNull();
  });

  it('does not count a relay-only provider behind an unavailable server', () => {
    providerRows = [{ id: 'r1', templateId: 'wafer', enabled: true, createdAt: 0 }];
    proxyGate = { enabled: false, reason: 'offline', tooltip: 'Server unreachable' };
    wrap(<SettingsProvidersPage />);
    expect(screen.queryByRole('link', { name: NEXT })).toBeNull();
  });

  it('does not count a provider without a chat model', () => {
    kindsOf = () => ['tts'];
    wrap(<SettingsProvidersPage />);
    expect(screen.queryByRole('link', { name: NEXT })).toBeNull();
  });

  it('is not shown with no providers at all', () => {
    providerRows = [];
    wrap(<SettingsProvidersPage />);
    expect(screen.queryByRole('link', { name: NEXT })).toBeNull();
  });
});

describe('SettingsProvidersPage — server relay status link', () => {
  it('"Open server linking" carries this list (with its own return) as ?return=', () => {
    proxyGate = { enabled: false, reason: 'local-only', tooltip: 'Needs a linked server.' };
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/app/settings/providers?return=/app']}>
          <SettingsProvidersPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByRole('link', { name: 'Open server linking' })).toHaveAttribute(
      'href',
      `/app/account/server-linking?return=${encodeURIComponent('/app/settings/providers?return=/app')}`,
    );
  });
});
