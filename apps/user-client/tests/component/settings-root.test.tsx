// SPDX-License-Identifier: AGPL-3.0-only
import { vi } from 'vitest';

// ─── Module mocks (hoisted before static imports by Vitest) ───────────────────

vi.mock('../../src/data/providers.js', () => ({ useProviders: () => ({ data: [] }) }));
vi.mock('../../src/data/settings.js', () => ({
  useSettings: () => ({ data: { corsProxy: null } }),
}));
vi.mock('../../src/content/help/use-help.js', () => ({
  useHelp: vi.fn(() => ({ onHelp: vi.fn(), helpOverlay: null })),
}));
vi.mock('@chatsundere/llm-unified', () => ({
  aggregateServiceKinds: () => [],
  getProvider: () => null,
}));
vi.mock('@chatsundere/ui-shared', () => ({
  motion: { respectsReducedMotion: () => true },
}));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (orig) => ({
  ...(await orig<typeof import('react-router-dom')>()),
  useNavigate: () => mockNavigate,
}));

// ─── Imports (resolved after mocks are registered) ────────────────────────────

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { Settings } from '../../src/routes/app/settings.js';

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('My Settings root matrix', () => {
  it('renders all six tiles', async () => {
    wrap(<Settings />);
    for (const label of [
      'You',
      'AI Providers',
      'Web Access',
      'Voice',
      'Images',
      '"Ask an Expert"',
    ]) {
      expect(await screen.findByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  it('disables Web Access when no provider offers web', async () => {
    wrap(<Settings />);
    const web = await screen.findByRole('button', { name: 'Web Access' });
    expect(web).toHaveAttribute('aria-disabled', 'true');
  });
});
