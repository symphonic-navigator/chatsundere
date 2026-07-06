// SPDX-License-Identifier: AGPL-3.0-only
import { useAccountLinkStore } from '@chatsundere/ui-shared';
import { render, screen } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db.js';
import { BlobSyncMarker, resolveBlobMarker } from '../../src/components/blob/BlobSyncMarker.js';
import { _resetQuotaSignalForTests } from '../../src/sync/quota-signal.js';
import { setAttention } from '../../src/sync/watermark.js';

describe('resolveBlobMarker (pure)', () => {
  it('a permanent oversize sentinel is always the too-large marker', () => {
    expect(resolveBlobMarker({ oversized: true, hasUnsyncedBlob: true, quotaBlocked: false })).toBe(
      'too-large',
    );
    expect(resolveBlobMarker({ oversized: true, hasUnsyncedBlob: false, quotaBlocked: true })).toBe(
      'too-large',
    );
  });

  it('an unsynced blob under a full server is the storage-full marker', () => {
    expect(resolveBlobMarker({ oversized: false, hasUnsyncedBlob: true, quotaBlocked: true })).toBe(
      'storage-full',
    );
  });

  it('a normal in-flight upload (quota fine) wears nothing', () => {
    expect(
      resolveBlobMarker({ oversized: false, hasUnsyncedBlob: true, quotaBlocked: false }),
    ).toBeNull();
  });

  it('a fully synced item wears nothing', () => {
    expect(
      resolveBlobMarker({ oversized: false, hasUnsyncedBlob: false, quotaBlocked: false }),
    ).toBeNull();
  });
});

describe('BlobSyncMarker (component)', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
    await openClientDataDb();
    _resetQuotaSignalForTests();
    useAccountLinkStore.getState().setLocalOnly();
  });
  afterEach(async () => {
    _resetQuotaSignalForTests();
    useAccountLinkStore.getState().setLocalOnly();
    await _resetClientDataDbForTests();
  });

  it('oversize → the "too large" marker', () => {
    render(<BlobSyncMarker oversized hasUnsyncedBlob />);
    expect(screen.getByText('Not synced — too large')).toBeInTheDocument();
  });

  it('a synced item → no marker at all', () => {
    const { container } = render(<BlobSyncMarker oversized={false} hasUnsyncedBlob={false} />);
    expect(container.querySelector('[data-blob-marker]')).toBeNull();
  });

  it('quota-waiting (linked + server full) → the "storage full" marker', async () => {
    useAccountLinkStore
      .getState()
      .setLinked({ base_url: 'https://s.example', issuer_label: 's.example', role: 'user' });
    await setAttention({ kind: 'quota_exceeded', usedBytes: 10, quotaBytes: 20 });

    render(<BlobSyncMarker oversized={false} hasUnsyncedBlob />);
    // The shared quota signal polls the linked server's attention; the marker
    // lights up once it observes the "storage full" state.
    expect(await screen.findByText('Not synced — storage full')).toBeInTheDocument();
  });
});
