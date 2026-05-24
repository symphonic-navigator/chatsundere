// SPDX-License-Identifier: AGPL-3.0-only

import { useSessionStore } from '@chatsundere/ui-shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { useDisplayName } from '../../src/data/settings.js';

function Probe(): JSX.Element {
  const name = useDisplayName();
  return <span data-testid="dn">{name}</span>;
}

function renderProbe() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <Probe />
    </QueryClientProvider>,
  );
}

describe('useDisplayName', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
    await openClientDataDb();
    useSessionStore.setState({ session: null });
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
    useSessionStore.setState({ session: null });
  });

  it('returns trimmed displayName when set', async () => {
    await getClientDataDb().settings.update(1, { displayName: '  Chris Tidesson  ' });
    useSessionStore.setState({ session: { username: 'chris151' } as never });
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('dn').textContent).toBe('Chris Tidesson'));
  });

  it('falls back to username when displayName is empty', async () => {
    useSessionStore.setState({ session: { username: 'chris151' } as never });
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('dn').textContent).toBe('chris151'));
  });

  it('falls back to username when displayName is whitespace only', async () => {
    await getClientDataDb().settings.update(1, { displayName: '   ' });
    useSessionStore.setState({ session: { username: 'chris151' } as never });
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('dn').textContent).toBe('chris151'));
  });

  it('returns "—" when neither displayName nor session.username is available', async () => {
    useSessionStore.setState({ session: null });
    renderProbe();
    await waitFor(() => expect(screen.getByTestId('dn').textContent).toBe('—'));
  });

  it('honours the fallback parameter when displayName and session are empty', async () => {
    useSessionStore.setState({ session: null });
    function ProbeWithFallback(): JSX.Element {
      const name = useDisplayName('local-username-fallback');
      return <span data-testid="dn-fb">{name}</span>;
    }
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <ProbeWithFallback />
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId('dn-fb').textContent).toBe('local-username-fallback'),
    );
  });
});
