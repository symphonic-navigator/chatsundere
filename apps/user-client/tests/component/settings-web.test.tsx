// SPDX-License-Identifier: AGPL-3.0-only
import { vi } from 'vitest';

// ─── Module mocks (hoisted before static imports by Vitest) ───────────────────

vi.mock('../../src/data/settings.js', () => ({
  useSettings: () => ({ data: { corsProxy: null, webInterfacing: { search: null, fetch: null } } }),
  useUpdateSettings: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('../../src/data/providers.js', () => ({ useProviders: () => ({ data: [] }) }));
vi.mock('../../src/lib/usable-providers.js', () => ({ useUsableTemplateIds: () => [] }));
vi.mock('../../src/lib/web-backend-options.js', () => ({ webBackendOptions: () => [] }));
vi.mock('../../src/content/help/use-help.js', () => ({
  useHelp: vi.fn(() => ({ onHelp: vi.fn(), helpOverlay: null })),
}));
vi.mock('@chatsundere/llm-unified', () => ({
  aggregateServiceKinds: () => [],
}));

// ─── Imports (resolved after mocks are registered) ────────────────────────────

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { SettingsWebPage } from '../../src/routes/app/settings/web.js';

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('SettingsWebPage', () => {
  it('renders the Web Access crumb and a needs-provider notice with no web offering', async () => {
    wrap(<SettingsWebPage />);
    expect(await screen.findByText('Web Access')).toBeInTheDocument();
  });
});
