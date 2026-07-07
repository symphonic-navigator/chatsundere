// SPDX-License-Identifier: AGPL-3.0-only
import { useAccountLinkStore, useConnectivityStore } from '@chatsundere/ui-shared';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import type { SyncAttention, SyncStateRow } from '../../src/boot/client-data-db.js';
import { GlobalSyncLine } from '../../src/components/GlobalSyncLine.js';
import { setRecovering } from '../../src/sync/watermark.js';

const BASE_STATE: SyncStateRow = {
  id: 'state',
  epoch: 'epoch-1',
  watermarkRev: 10,
  lastSyncAt: Date.now(),
  pulling: null,
  attention: null,
};

async function seedState(patch: Partial<SyncStateRow>): Promise<void> {
  await getClientDataDb().syncState.put({ ...BASE_STATE, ...patch });
}

function linkOnline(): void {
  useAccountLinkStore
    .getState()
    .setLinked({ base_url: 'https://s.example', issuer_label: 's.example', role: 'user' });
  useConnectivityStore.getState().setState({ kind: 'linked_online' });
}

/** Render the global line inside a router positioned on an `/app` route (§3.7). */
function renderOnApp() {
  return render(
    <MemoryRouter initialEntries={['/app']}>
      <GlobalSyncLine />
    </MemoryRouter>,
  );
}

describe('GlobalSyncLine', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
    await openClientDataDb();
    setRecovering(false);
    useConnectivityStore.getState().setState({ kind: 'linked_online' });
    useAccountLinkStore.getState().setLocalOnly();
  });
  afterEach(async () => {
    setRecovering(false);
    await _resetClientDataDbForTests();
  });

  it('shows backfill progress while a backfill is pending', async () => {
    linkOnline();
    await seedState({
      backfillPending: true,
      backfillTotal: 500,
      backfillDone: 120,
      watermarkRev: 1,
    });
    renderOnApp();
    expect(await screen.findByText('Uploading your existing data… 120 of 500')).toBeInTheDocument();
  });

  it('shows an attention state with its retry affordance', async () => {
    linkOnline();
    const attention: SyncAttention = { kind: 'recovery_paused' };
    await seedState({ watermarkRev: 10, attention });
    renderOnApp();
    expect(
      await screen.findByText('Your server is behaving inconsistently — syncing is paused.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('renders nothing for a plain synced state (only backfill + attention surface here)', async () => {
    linkOnline();
    await seedState({ watermarkRev: 10, lastSyncAt: Date.now() });
    const { container } = renderOnApp();
    // The poll runs immediately on mount; give it a macrotask, then assert the
    // surface stayed empty — a synced state carries no global line.
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(container.querySelector('[data-global-sync-status]')).toBeNull();
  });

  it('renders nothing for a local-only (non-linked) user', async () => {
    // beforeEach left the store local-only; do not link.
    await seedState({
      backfillPending: true,
      backfillTotal: 500,
      backfillDone: 1,
      watermarkRev: 1,
    });
    const { container } = renderOnApp();
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(container.querySelector('[data-global-sync-status]')).toBeNull();
  });

  it('shows the transport_failing attention and lets it collapse (no affordance to hide)', async () => {
    // Laura soft (pre-test analysis #8): an affordance-less, self-healing
    // attention must not pin an unactionable warning over the chat — it may
    // tuck to the dot exactly like backfill.
    linkOnline();
    const attention: SyncAttention = { kind: 'transport_failing' };
    await seedState({ watermarkRev: 10, attention });
    renderOnApp();
    expect(await screen.findByText(/Syncing is not getting through/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Collapse sync status' }));
    expect(screen.getByRole('button', { name: 'Show sync status' })).toBeInTheDocument();
    expect(screen.queryByText(/Syncing is not getting through/)).not.toBeInTheDocument();
  });

  it('an attention with an affordance never collapses', async () => {
    linkOnline();
    const attention: SyncAttention = { kind: 'recovery_paused' };
    await seedState({ watermarkRev: 10, attention });
    renderOnApp();
    await screen.findByText('Your server is behaving inconsistently — syncing is paused.');

    fireEvent.click(screen.getByRole('button', { name: 'Collapse sync status' }));
    // Still fully visible — the Retry affordance must never hide behind the dot.
    expect(
      screen.getByText('Your server is behaving inconsistently — syncing is paused.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('collapses to a dot and expands back on tap', async () => {
    linkOnline();
    await seedState({
      backfillPending: true,
      backfillTotal: 500,
      backfillDone: 120,
      watermarkRev: 1,
    });
    renderOnApp();
    // Full line is visible first.
    await screen.findByText('Uploading your existing data… 120 of 500');

    // Collapse → the dot appears, the text goes away.
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sync status' }));
    expect(screen.getByRole('button', { name: 'Show sync status' })).toBeInTheDocument();
    expect(screen.queryByText('Uploading your existing data… 120 of 500')).not.toBeInTheDocument();

    // Expand → the full text returns.
    fireEvent.click(screen.getByRole('button', { name: 'Show sync status' }));
    await waitFor(() =>
      expect(screen.getByText('Uploading your existing data… 120 of 500')).toBeInTheDocument(),
    );
  });
});
