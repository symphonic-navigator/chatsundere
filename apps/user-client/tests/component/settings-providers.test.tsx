// SPDX-License-Identifier: AGPL-3.0-only
import { vi } from 'vitest';

// ─── Module mocks (hoisted before static imports by Vitest) ───────────────────

// Mutable so individual tests can set a non-empty list without re-mocking.
let providerRows: Array<{ id: string; templateId: string; enabled: boolean; createdAt: number }> =
  [];

vi.mock('../../src/data/providers.js', () => ({ useProviders: () => ({ data: providerRows }) }));
vi.mock('../../src/data/settings.js', () => ({
  useSettings: () => ({ data: { corsProxy: null } }),
  useUpdateSettings: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('../../src/content/help/use-help.js', () => ({
  useHelp: vi.fn(() => ({ onHelp: vi.fn(), helpOverlay: null })),
}));
vi.mock('@chatsundere/llm-unified', () => ({
  MODALITY_ORDER: ['llm', 'web', 'tts', 'stt', 'tti'],
  getProvider: (id: string) => ({
    corsHint: 'direct',
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
});
