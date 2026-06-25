// SPDX-License-Identifier: AGPL-3.0-only
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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
});
