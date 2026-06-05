// SPDX-License-Identifier: AGPL-3.0-only
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

let providerRows: Array<{ id: string; templateId: string; enabled: boolean }> = [];
vi.mock('../../src/data/providers.js', () => ({ useProviders: () => ({ data: providerRows }) }));
vi.mock('../../src/data/settings.js', () => ({
  useSettings: () => ({ data: { corsProxy: null } }),
  useUpdateSettings: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('../../src/lib/secrets.js', () => ({ sealSecret: vi.fn(), openSecret: vi.fn() }));
vi.mock('@chatsundere/ui-shared', () => ({
  useSessionStore: (sel: (s: { mk: unknown }) => unknown) => sel({ mk: null }),
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

import { ProvidersSection } from '../../src/routes/app/settings.js';

describe('Upstream Providers section', () => {
  it('shows the empty state and the proxy block when no provider is configured', () => {
    providerRows = [];
    render(<ProvidersSection />);
    expect(screen.getByText(/no voice yet/i)).toBeInTheDocument();
    expect(screen.getByText(/server connection at beta/i)).toBeInTheDocument();
  });

  it('lists only configured providers (not all built-ins)', () => {
    providerRows = [{ id: 'r1', templateId: 'chutes', enabled: true }];
    render(<ProvidersSection />);
    expect(screen.getByText('chutes')).toBeInTheDocument();
    expect(screen.queryByText('OpenRouter')).not.toBeInTheDocument();
  });
});
