// SPDX-License-Identifier: AGPL-3.0-only
import { vi } from 'vitest';

// ─── Module mocks (hoisted before static imports by Vitest) ───────────────────

// useHelp pulls in katex and other heavy deps — keep render lean
vi.mock('../../src/content/help/use-help.js', () => ({
  useHelp: vi.fn(() => ({ onHelp: vi.fn(), helpOverlay: null })),
}));

vi.mock('../../src/data/settings.js', () => ({
  useSettings: () => ({ data: { corsProxy: null, expertModel: null, expertWeb: null } }),
  useUpdateSettings: () => ({ mutate: vi.fn() }),
}));

vi.mock('../../src/data/providers.js', () => ({ useProviders: () => ({ data: [] }) }));

vi.mock('../../src/lib/usable-providers.js', () => ({
  useUsableTemplateIds: () => [],
  usableTemplateIds: () => [],
}));

vi.mock('../../src/lib/web-backend-options.js', () => ({ webBackendOptions: () => [] }));

vi.mock('../../src/lib/resolve-expert-web.js', () => ({
  pickExpertSearchRef: () => null,
}));

vi.mock('@chatsundere/llm-unified', () => ({
  aggregateServiceKinds: () => [],
  getOffering: () => null,
}));

// ModelSlotPicker opens ModelPickerOverlay which hits the llm-unified catalogue — mock at boundary
vi.mock('../../src/components/ModelSlotPicker.js', () => ({
  ModelSlotPicker: ({ label }: { label: string }) => <div>{label}</div>,
}));

// ─── Imports (resolved after mocks are registered) ────────────────────────────

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { SettingsExpertPage } from '../../src/routes/app/settings/expert.js';

describe('SettingsExpertPage', () => {
  it('renders the expert-model slot and the privacy reassurance', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <SettingsExpertPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText(/Expert model/i)).toBeInTheDocument();
    expect(screen.getByText(/only the sanitised question/i)).toBeInTheDocument();
  });

  it('shows the Artefact expert slot', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <SettingsExpertPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByRole('heading', { name: /Artefact expert/i })).toBeInTheDocument();
  });
});
