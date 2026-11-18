// SPDX-License-Identifier: AGPL-3.0-only

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { MOTION_STORAGE_KEY } from '../../src/lib/reduced-motion.js';
import { Root } from '../../src/routes/root.js';

function renderRoot(): void {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <Root />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Root applies the Reduce animations switch to the root element', () => {
  beforeEach(async () => {
    sessionStorage.setItem('splashShown', '1');
    await _resetClientDataDbForTests();
    await openClientDataDb();
  });
  afterEach(async () => {
    sessionStorage.clear();
    localStorage.clear();
    delete document.documentElement.dataset.motion;
    await _resetClientDataDbForTests();
  });

  it('marks the root and mirrors the flag when animations are off', async () => {
    await getClientDataDb().settings.update(1, { animationsEnabled: false });
    renderRoot();
    await waitFor(() => expect(document.documentElement.dataset.motion).toBe('reduced'));
    expect(localStorage.getItem(MOTION_STORAGE_KEY)).toBe('1');
  });

  it('clears a stale first-paint mirror once the settings row says animations are on', async () => {
    localStorage.setItem(MOTION_STORAGE_KEY, '1');
    document.documentElement.dataset.motion = 'reduced';
    renderRoot();
    await waitFor(() => expect(document.documentElement.hasAttribute('data-motion')).toBe(false));
    expect(localStorage.getItem(MOTION_STORAGE_KEY)).toBeNull();
  });
});
