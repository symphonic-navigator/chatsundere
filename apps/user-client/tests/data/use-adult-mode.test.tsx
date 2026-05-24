// SPDX-License-Identifier: AGPL-3.0-only

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { useAdultMode } from '../../src/data/settings.js';

function Probe(): JSX.Element {
  const { mode, toggleMode, setMode } = useAdultMode();
  return (
    <div>
      <span data-testid="mode">{mode}</span>
      <button data-testid="toggle" type="button" onClick={() => void toggleMode()}>
        toggle
      </button>
      <button data-testid="set-sfw" type="button" onClick={() => void setMode('sfw')}>
        sfw
      </button>
    </div>
  );
}

function renderProbe() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Probe />
    </QueryClientProvider>,
  );
}

describe('useAdultMode', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
    await openClientDataDb();
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('returns "nsfw" by default (fresh install)', async () => {
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('mode').textContent).toBe('nsfw'));
  });

  it('toggleMode flips nsfw → sfw and persists', async () => {
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('mode').textContent).toBe('nsfw'));
    await act(async () => {
      screen.getByTestId('toggle').click();
    });
    await waitFor(() => expect(screen.getByTestId('mode').textContent).toBe('sfw'));
    const settings = await getClientDataDb().settings.get(1);
    expect(settings?.adultMode).toBe('sfw');
  });

  it('setMode writes a specific value', async () => {
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('mode').textContent).toBe('nsfw'));
    await act(async () => {
      screen.getByTestId('set-sfw').click();
    });
    await waitFor(() => expect(screen.getByTestId('mode').textContent).toBe('sfw'));
  });
});
