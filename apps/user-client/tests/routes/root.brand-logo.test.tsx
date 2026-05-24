// SPDX-License-Identifier: AGPL-3.0-only

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db.js';
import { Root } from '../../src/routes/root.js';

describe('Root brand logo', () => {
  beforeEach(async () => {
    sessionStorage.setItem('splashShown', '1'); // skip splash; assert on topbar logo
    await _resetClientDataDbForTests();
    await openClientDataDb();
  });
  afterEach(async () => {
    sessionStorage.clear();
    await _resetClientDataDbForTests();
  });

  it('renders the wordmark inside a span carrying the gradient class', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <Root />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const wordmark = screen.getByText('Chatsundere');
    expect(wordmark).toBeInTheDocument();
    expect(wordmark.className).toContain('brand-logo-text');
    expect(wordmark.closest('a')?.className).toContain('brand-logo');
    expect(wordmark.closest('a')?.className).not.toContain('italic');
  });

  it('renders the twinkle as a sibling span with aria-hidden', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter>
          <Root />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const twinkle = screen.getByText('✦');
    expect(twinkle).toBeInTheDocument();
    expect(twinkle.getAttribute('aria-hidden')).toBe('true');
    expect(twinkle.className).toContain('brand-logo-twinkle');
  });
});
