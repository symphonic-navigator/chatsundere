// SPDX-License-Identifier: AGPL-3.0-only
import { vi } from 'vitest';

// ─── Module mocks (hoisted before static imports by Vitest) ───────────────────

// useHelp pulls in katex and other heavy deps — keep render lean
vi.mock('../../src/content/help/use-help.js', () => ({
  useHelp: vi.fn(() => ({ onHelp: vi.fn(), helpOverlay: null })),
}));

vi.mock('../../src/data/settings.js', () => ({
  useSettings: () => ({ data: { corsProxy: null, substituteVisionModel: null } }),
  useUpdateSettings: () => ({ mutate: vi.fn() }),
}));

vi.mock('../../src/data/providers.js', () => ({ useProviders: () => ({ data: [] }) }));

// ImageGenerationSection pulls in TTI catalogue and provider data — mock at module boundary
vi.mock('../../src/components/image-gen/ImageGenerationSection.js', () => ({
  ImageGenerationSection: () => <div>Image Generation Section</div>,
}));

// ─── Imports (resolved after mocks are registered) ────────────────────────────

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { SettingsImagesPage } from '../../src/routes/app/settings/images.js';

describe('SettingsImagesPage', () => {
  it('renders the Reading images and Creating images blocks', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <SettingsImagesPage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText('Reading images')).toBeInTheDocument();
    expect(screen.getByText('Creating images')).toBeInTheDocument();
  });
});
