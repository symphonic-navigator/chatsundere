// SPDX-License-Identifier: AGPL-3.0-only
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { SettingsVoicePage } from '../../src/routes/app/settings/voice.js';

// Mock useHelp to avoid pulling katex and other heavy dependencies
vi.mock('../../src/content/help/use-help.js', () => ({
  useHelp: () => ({
    onHelp: vi.fn(),
    helpOverlay: null,
  }),
}));

// Mock VoiceSection to avoid heavy dependencies
vi.mock('../../src/components/voice/VoiceSection.js', () => ({
  VoiceSection: () => <div>Voice Section</div>,
}));

describe('SettingsVoicePage', () => {
  it('renders the Voice crumb and the voice section', async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <SettingsVoicePage />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByText('Voice')).toBeInTheDocument();
  });

  function Where(): JSX.Element {
    return <div data-testid="where">{useLocation().pathname}</div>;
  }

  function renderWithState(state: unknown) {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={[{ pathname: '/app/settings/voice', state }]}>
          <Routes>
            <Route path="/app/settings/voice" element={<SettingsVoicePage />} />
            <Route path="*" element={<Where />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it('goes back to the page that sent the user here', () => {
    renderWithState({ returnTo: '/app/persona/p-1/font-voice' });
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByTestId('where').textContent).toBe('/app/persona/p-1/font-voice');
  });

  it('falls back to My Settings without a return target', () => {
    renderWithState(null);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByTestId('where').textContent).toBe('/app/settings');
  });

  it('ignores a return target outside the app', () => {
    renderWithState({ returnTo: '//evil.example/app' });
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByTestId('where').textContent).toBe('/app/settings');
  });
});
