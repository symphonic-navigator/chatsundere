// SPDX-License-Identifier: AGPL-3.0-only
import { useAccountLinkStore, useConnectivityStore } from '@chatsundere/ui-shared';
import { render, screen } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import type { SyncAttention, SyncStateRow } from '../../src/boot/client-data-db.js';
import { SyncStatusLine, deriveSyncStatus } from '../../src/components/SyncStatusLine.js';
import {
  _resetBlobFetchForTests,
  _setBlobFetchDeps,
  enqueueEager,
} from '../../src/sync/blob-fetch.js';
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

describe('SyncStatusLine', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
    await openClientDataDb();
    setRecovering(false);
    useConnectivityStore.getState().setState({ kind: 'linked_online' });
    useAccountLinkStore.getState().setLocalOnly();
  });
  afterEach(async () => {
    setRecovering(false);
    _resetBlobFetchForTests();
    await _resetClientDataDbForTests();
  });

  it('renders nothing for a local-only user (no sync engine)', async () => {
    useAccountLinkStore.getState().setLocalOnly();
    const { container } = render(<SyncStatusLine />);
    // No linked account → the engine does not exist; nothing polls or renders.
    expect(container.querySelector('[data-sync-status]')).toBeNull();
  });

  it('Synced: outbox empty, no pull, no attention', async () => {
    linkOnline();
    await seedState({ watermarkRev: 10, lastSyncAt: Date.now() });
    render(<SyncStatusLine />);
    const el = await screen.findByText(/^Synced/);
    expect(el).toBeInTheDocument();
  });

  it('Waiting: online with pending outbox entries', async () => {
    linkOnline();
    await seedState({ watermarkRev: 10 });
    await getClientDataDb().syncOutbox.add({
      collection: 'chats',
      key: 'c1',
      op: 'upsert',
      enqueuedAt: Date.now(),
    });
    await getClientDataDb().syncOutbox.add({
      collection: 'chats',
      key: 'c2',
      op: 'upsert',
      enqueuedAt: Date.now(),
    });
    render(<SyncStatusLine />);
    expect(await screen.findByText('2 changes waiting')).toBeInTheDocument();
  });

  it('Offline: linked but the server is unreachable', async () => {
    linkOnline();
    useConnectivityStore.getState().setState({ kind: 'server_unreachable' });
    await seedState({ watermarkRev: 10 });
    render(<SyncStatusLine />);
    expect(await screen.findByText('Offline — changes queued')).toBeInTheDocument();
  });

  it('Pulling: an active multi-page pull shows progress', async () => {
    linkOnline();
    await seedState({ watermarkRev: 10, pulling: { pages: 3, startedAt: Date.now() } });
    render(<SyncStatusLine />);
    expect(await screen.findByText('Pulling your data onto this device…')).toBeInTheDocument();
    expect(await screen.findByText(/3 pages so far/)).toBeInTheDocument();
  });

  it('Pulling: always shown on watermarkRev === 0 (fresh device)', async () => {
    linkOnline();
    await seedState({ watermarkRev: 0, pulling: null });
    render(<SyncStatusLine />);
    expect(await screen.findByText('Pulling your data onto this device…')).toBeInTheDocument();
  });

  it('"Synced" EXCLUDES an active pull — a pulling-set state renders Pulling, not Synced', async () => {
    linkOnline();
    // Outbox empty, attention null, watermark advanced: the ONLY thing that
    // must keep this out of "Synced" is the active pull.
    await seedState({ watermarkRev: 42, pulling: { pages: 1, startedAt: Date.now() } });
    render(<SyncStatusLine />);
    expect(await screen.findByText('Pulling your data onto this device…')).toBeInTheDocument();
    expect(screen.queryByText(/^Synced/)).not.toBeInTheDocument();
  });

  it('Recovery: the calm re-check copy while recovery is running', async () => {
    linkOnline();
    await seedState({ watermarkRev: 10 });
    setRecovering(true);
    render(<SyncStatusLine />);
    expect(
      await screen.findByText('Re-checking everything is in sync — your data is safe.'),
    ).toBeInTheDocument();
  });

  it('Attention: recovery_paused shows the catalogue copy and a retry affordance', async () => {
    linkOnline();
    const attention: SyncAttention = { kind: 'recovery_paused' };
    await seedState({ watermarkRev: 10, attention });
    render(<SyncStatusLine />);
    expect(
      await screen.findByText('Your server is behaving inconsistently — syncing is paused.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('"Fetching images…" gates "Synced" while the eager queue drains (§6)', async () => {
    linkOnline();
    await seedState({ watermarkRev: 10, lastSyncAt: Date.now() });
    // A never-resolving eager fetch keeps the queue active.
    _setBlobFetchDeps({
      getMk: () => new Uint8Array([1]) as never,
      getBlob: () => new Promise<Uint8Array>(() => {}),
    });
    enqueueEager('artefacts', 'a1', 'thumbBlob', { blobId: 'AAAAAAAAAAAAAAAAAAAAAA', bytes: 10 });

    render(<SyncStatusLine />);
    expect(await screen.findByText('Fetching images…')).toBeInTheDocument();
    // Records are settled, but the line must not yet claim completion.
    expect(screen.queryByText(/^Synced/)).not.toBeInTheDocument();
  });

  it('Attention: quota_exceeded interpolates used/quota bytes', async () => {
    linkOnline();
    const attention: SyncAttention = {
      kind: 'quota_exceeded',
      usedBytes: 1_572_864,
      quotaBytes: 5_242_880,
    };
    await seedState({ watermarkRev: 10, attention });
    render(<SyncStatusLine />);
    expect(await screen.findByText(/1\.5 MB of 5 MB used/)).toBeInTheDocument();
  });
});

describe('deriveSyncStatus (pure precedence)', () => {
  const base = { watermarkRev: 10, outboxCount: 0, online: true, recovering: false } as const;

  it('recovery outranks everything', () => {
    const view = deriveSyncStatus({
      state: { ...BASE_STATE, attention: { kind: 'tamper' }, pulling: { pages: 1, startedAt: 0 } },
      outboxCount: 3,
      online: true,
      recovering: true,
    });
    expect(view.kind).toBe('recovery');
  });

  it('fetchingImages gates Synced but Waiting still outranks it', () => {
    const fetching = deriveSyncStatus({
      state: { ...BASE_STATE },
      outboxCount: 0,
      online: true,
      recovering: false,
      fetchingImages: true,
    });
    expect(fetching.kind).toBe('fetching');

    const waiting = deriveSyncStatus({
      state: { ...BASE_STATE },
      outboxCount: 2,
      online: true,
      recovering: false,
      fetchingImages: true,
    });
    expect(waiting.kind).toBe('waiting');
  });

  it('a pulling-set state never resolves to Synced', () => {
    const view = deriveSyncStatus({
      state: {
        ...BASE_STATE,
        watermarkRev: base.watermarkRev,
        pulling: { pages: 2, startedAt: 0 },
      },
      outboxCount: 0,
      online: true,
      recovering: false,
    });
    expect(view.kind).toBe('pulling');
  });
});
