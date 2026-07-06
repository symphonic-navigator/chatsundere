// SPDX-License-Identifier: AGPL-3.0-only
import { useAccountLinkStore, useConnectivityStore } from '@chatsundere/ui-shared';
import { fireEvent, render, screen } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import type { SyncStateRow } from '../../src/boot/client-data-db.js';
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

/** Render the global line at `/app`, with a probe route to assert navigation. */
function renderOnApp() {
  return render(
    <MemoryRouter initialEntries={['/app']}>
      <GlobalSyncLine />
      <Routes>
        <Route path="/app" element={<div>app-surface</div>} />
        <Route path="/onboarding/invitation" element={<div>invitation-surface</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('auth-degraded UX (spec §5.2)', () => {
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

  it('renders the dere copy and a Reconnect action that navigates to the invitation flow', async () => {
    linkOnline();
    await seedState({ watermarkRev: 10, attention: { kind: 'auth_degraded' } });
    renderOnApp();

    expect(await screen.findByText(/no longer recognises this device/i)).toBeInTheDocument();
    expect(screen.getByText(/your data is safe here/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /reconnect/i }));
    expect(await screen.findByText('invitation-surface')).toBeInTheDocument();
  });
});
