// SPDX-License-Identifier: AGPL-3.0-only
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { SettingsImagesPage } from '../../src/routes/app/settings/images.js';

// The page's heavy children are irrelevant to the back control.
vi.mock('../../src/components/image-gen/ImageGenerationSection.js', () => ({
  ImageGenerationSection: () => <div data-testid="image-gen-section" />,
}));
vi.mock('../../src/components/ModelSlotPicker.js', () => ({
  ModelSlotPicker: () => <div data-testid="model-slot-picker" />,
}));
vi.mock('../../src/data/providers.js', () => ({ useProviders: () => ({ data: [] }) }));
vi.mock('../../src/data/settings.js', () => ({
  useSettings: () => ({ data: { substituteVisionModel: null } }),
  useUpdateSettings: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
}));
vi.mock('../../src/lib/server-gate.js', () => ({ useServerGate: () => ({ enabled: false }) }));
vi.mock('../../src/content/help/use-help.js', () => ({
  useHelp: () => ({ onHelp: vi.fn(), helpOverlay: null }),
}));

function renderAt(url: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[url]}>
        <Routes>
          <Route path="/app/settings/images" element={<SettingsImagesPage />} />
          <Route path="/app/settings" element={<div data-testid="settings-sentinel" />} />
          <Route path="/app/chat/:chatId" element={<div data-testid="chat-sentinel" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('SettingsImagesPage — return path', () => {
  it('?return= drives the back control', async () => {
    renderAt(`/app/settings/images?return=${encodeURIComponent('/app/chat/c1')}`);
    fireEvent.click(await screen.findByRole('button', { name: /^back$/i }));
    await waitFor(() => expect(screen.getByTestId('chat-sentinel')).toBeInTheDocument());
  });

  it('without ?return= back goes to My Settings', async () => {
    renderAt('/app/settings/images');
    fireEvent.click(await screen.findByRole('button', { name: /^back$/i }));
    await waitFor(() => expect(screen.getByTestId('settings-sentinel')).toBeInTheDocument());
  });
});
