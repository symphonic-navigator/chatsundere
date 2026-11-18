// SPDX-License-Identifier: AGPL-3.0-only

import { useAccountLinkStore } from '@chatsundere/ui-shared';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Module mocks ─────────────────────────────────────────────────────────────

vi.mock('../../src/content/help/use-help.js', () => ({
  useHelp: vi.fn(() => ({ onHelp: vi.fn(), helpOverlay: null })),
}));

function LocationProbe() {
  const loc = useLocation();
  return <div data-testid="location">{`${loc.pathname}${loc.search}`}</div>;
}

import { ServerLinkingPage } from '../../src/routes/app/account/server-linking.js';

function renderPage(url = '/app/account/server-linking') {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/app/account/server-linking" element={<ServerLinkingPage />} />
        <Route path="/onboarding/invitation" element={<LocationProbe />} />
        <Route path="*" element={<LocationProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('ServerLinkingPage', () => {
  beforeEach(() => {
    useAccountLinkStore.setState({
      linkStatus: 'local-only',
      baseUrl: null,
      issuerLabel: null,
      role: null,
    });
  });

  it('renders the PageBar with My Account / Server linking crumbs', () => {
    renderPage();
    expect(screen.getByText('My Account')).toBeInTheDocument();
    expect(screen.getByText('Server linking')).toBeInTheDocument();
  });

  it('renders the "Local-only mode" status badge', () => {
    renderPage();
    expect(screen.getByText('Local-only mode')).toBeInTheDocument();
  });

  it('navigates to /onboarding/invitation?return=/app/account/server-linking on "Link to server"', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /link to server/i }));
    expect(screen.getByTestId('location').textContent).toBe(
      `/onboarding/invitation?return=${encodeURIComponent('/app/account/server-linking')}`,
    );
  });

  it('"Link to server" passes the full URL, its own ?return= included', () => {
    const own = `?return=${encodeURIComponent('/app/settings/providers?return=/app')}`;
    renderPage(`/app/account/server-linking${own}`);
    fireEvent.click(screen.getByRole('button', { name: /link to server/i }));
    const text = screen.getByTestId('location').textContent ?? '';
    const sent = new URLSearchParams(text.slice(text.indexOf('?')));
    expect(sent.get('return')).toBe(`/app/account/server-linking${own}`);
  });

  it('?return= drives the back control', () => {
    renderPage(
      `/app/account/server-linking?return=${encodeURIComponent('/app/settings/providers?return=/app')}`,
    );
    fireEvent.click(screen.getByRole('button', { name: /^back$/i }));
    expect(screen.getByTestId('location').textContent).toBe('/app/settings/providers?return=/app');
  });

  it('without ?return= back goes to My Account', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /^back$/i }));
    expect(screen.getByTestId('location').textContent).toBe('/app/account');
  });
});
