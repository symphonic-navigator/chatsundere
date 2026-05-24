// SPDX-License-Identifier: AGPL-3.0-only

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { ServerLinkingSection } from '../../src/routes/app/account-sections/server-linking-section.js';

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="location">{`${loc.pathname}${loc.search}`}</div>;
}

describe('ServerLinkingSection → invitation wizard', () => {
  it('passes ?return=/app/account when the "Link to server" button is clicked', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={['/app/account']}>
          <Routes>
            <Route path="/app/account" element={<ServerLinkingSection serverUrl={null} />} />
            <Route path="/onboarding/invitation" element={<LocationProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /link to server/i }));
    expect(screen.getByTestId('location').textContent).toBe(
      '/onboarding/invitation?return=/app/account',
    );
  });
});
