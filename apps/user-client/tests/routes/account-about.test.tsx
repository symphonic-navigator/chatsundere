// SPDX-License-Identifier: AGPL-3.0-only

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

// ─── Module mocks ──────────────────────────────────────────────────────────────
// Must come before the dynamic import of the component below.

// Stub heavy MarkdownContent (same pattern as ReadingOverlay test).
vi.mock('../../src/components/chat/markdown/MarkdownContent.js', () => ({
  MarkdownContent: ({ text }: { text: string }) => <div data-md>{text}</div>,
}));

// Stub origin-zoom (needs DOM layout; irrelevant here).
vi.mock('../../src/lib/origin-zoom.js', () => ({
  computeTransformOrigin: () => 'center center',
}));

// Stub NavZoom (no router transition needed).
vi.mock('../../src/lib/use-nav-zoom.js', () => ({
  NAV_BLINK_MS: 0,
  useNavZoom: () => vi.fn(),
}));

// Stub motion so blink resolves synchronously.
vi.mock('@chatsundere/ui-shared', () => ({
  motion: { respectsReducedMotion: () => true },
  useSessionStore: Object.assign(
    vi.fn((selector: (s: { session: { username: string } | null }) => unknown) =>
      selector({ session: { username: 'navigator' } }),
    ),
    { getState: () => ({ session: { username: 'navigator' }, mk: null }) },
  ),
}));

// Stub useHelp — provides a help button and null overlay.
vi.mock('../../src/content/help/use-help.js', () => ({
  useHelp: vi.fn(() => ({ onHelp: vi.fn(), helpOverlay: null })),
}));

// Stable version stub.
vi.mock('../../src/lib/version.js', () => ({
  APP_VERSION: { version: '0.0.0-test', sha: 'abc1234', builtAt: '2026-01-01T00:00:00Z' },
}));

// Stub content imports so markdown/raw files resolve in Vitest (no Vite).
vi.mock('../../src/content/help/index.js', () => ({
  AGPL_MD: '# GNU AGPL v3.0\nThis is the licence text.',
  PRIVACY_MD: '# Privacy\nWe store nothing on servers.',
  HELP_DOCS: {
    about: { title: 'About — help', markdown: 'help text' },
  },
}));

vi.mock('../../src/content/about/third-party.js', () => ({
  renderThirdPartyMarkdown: () => '# Third-party libraries\n- **React** `v18.3`',
}));

import { AboutPage } from '../../src/routes/app/account/about.js';

function renderPage() {
  return render(
    <MemoryRouter>
      <AboutPage />
    </MemoryRouter>,
  );
}

describe('AboutPage', () => {
  it('renders breadcrumbs: My Account / About', () => {
    renderPage();
    expect(screen.getByText('My Account')).toBeInTheDocument();
    expect(screen.getByText('About')).toBeInTheDocument();
  });

  it('shows the version, sha, and builtAt in the dashboard', () => {
    renderPage();
    expect(screen.getByText('0.0.0-test')).toBeInTheDocument();
    expect(screen.getByText('abc1234')).toBeInTheDocument();
    expect(screen.getByText('2026-01-01T00:00:00Z')).toBeInTheDocument();
  });

  it('shows the copyright line', () => {
    renderPage();
    expect(screen.getByText(/Copyright © 2026 Chatsundere contributors/)).toBeInTheDocument();
  });

  it('renders a "Licence" tile (British spelling)', () => {
    renderPage();
    expect(screen.getByRole('button', { name: 'Licence' })).toBeInTheDocument();
  });

  it('renders the "Source Code" tile', () => {
    renderPage();
    expect(screen.getByRole('button', { name: 'Source Code' })).toBeInTheDocument();
  });

  it('renders the "Privacy" tile', () => {
    renderPage();
    expect(screen.getByRole('button', { name: 'Privacy' })).toBeInTheDocument();
  });

  it('renders the "Third-party libraries" tile', () => {
    renderPage();
    expect(screen.getByRole('button', { name: 'Third-party libraries' })).toBeInTheDocument();
  });

  it('tapping "Licence" opens a ReadingOverlay with the AGPL title', async () => {
    renderPage();
    const tile = screen.getByRole('button', { name: 'Licence' });
    fireEvent.click(tile);
    await waitFor(() =>
      expect(
        screen.getByRole('dialog', { name: 'GNU Affero General Public License v3.0' }),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText(/This is the licence text/)).toBeInTheDocument();
  });

  it('closing the Licence overlay returns to the matrix', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Licence' }));
    await waitFor(() => expect(screen.getByRole('dialog')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('tapping "Privacy" opens a ReadingOverlay with the privacy title', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Privacy' }));
    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: 'Privacy & data handling' })).toBeInTheDocument(),
    );
    expect(screen.getByText(/We store nothing on servers/)).toBeInTheDocument();
  });

  it('tapping "Third-party libraries" opens a ReadingOverlay listing a known library', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Third-party libraries' }));
    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: 'Third-party libraries' })).toBeInTheDocument(),
    );
    // The stub renderThirdPartyMarkdown() includes "React"
    expect(screen.getByText(/React/)).toBeInTheDocument();
  });

  it('renders a "Developer tools" tile in DEV mode (import.meta.env.DEV is true in vitest)', () => {
    // Vitest runs with import.meta.env.DEV === true; in a production build the
    // tile is absent (the condition collapses to null). We verify the DEV-mode
    // path here; the absence in production is a build-time guarantee, not testable
    // in this environment.
    renderPage();
    expect(screen.getByRole('button', { name: 'Developer tools' })).toBeInTheDocument();
  });
});
