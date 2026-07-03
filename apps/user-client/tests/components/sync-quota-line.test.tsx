// SPDX-License-Identifier: AGPL-3.0-only
import type { BlobListResponse } from '@chatsundere/shared-types';
import { useAccountLinkStore } from '@chatsundere/ui-shared';
import { render, screen, waitFor } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db.js';
import { SyncQuotaLine } from '../../src/components/SyncQuotaLine.js';
import { _resetQuotaSignalForTests } from '../../src/sync/quota-signal.js';

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
  _resetQuotaSignalForTests();
  useAccountLinkStore.getState().setLocalOnly();
});
afterEach(async () => {
  _resetQuotaSignalForTests();
  await _resetClientDataDbForTests();
});

describe('SyncQuotaLine (§9 — display-only quota row)', () => {
  it('renders "X of Y storage used" naming the linked instance host', async () => {
    const inventory: BlobListResponse = {
      blobs: [],
      totalBytes: 1_572_864, // 1.5 MB
      quotaBytes: 5_242_880, // 5 MB
    };
    render(<SyncQuotaLine baseUrl="https://s.example" fetchInventory={async () => inventory} />);
    expect(
      await screen.findByText(/1\.5 MB of 5 MB storage used on your server at s\.example/),
    ).toBeInTheDocument();
  });

  it('a failed inventory read simply hides the line — never an alarm', async () => {
    const { container } = render(
      <SyncQuotaLine
        baseUrl="https://s.example"
        fetchInventory={async () => {
          throw new Error('offline');
        }}
      />,
    );
    // Give the mount fetch a chance to reject, then assert the line never appears.
    await waitFor(() => {
      expect(container.querySelector('[data-sync-quota]')).toBeNull();
    });
  });
});
