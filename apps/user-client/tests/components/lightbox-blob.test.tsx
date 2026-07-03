// SPDX-License-Identifier: AGPL-3.0-only
import type { MasterKey } from '@chatsundere/crypto';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { Lightbox } from '../../src/components/lightbox/Lightbox.js';
import type { ViewableItem } from '../../src/components/lightbox/viewable-item.js';
import { _resetBlobFetchForTests, _setBlobFetchDeps } from '../../src/sync/blob-fetch.js';
import { _resetBlobRepairForTests } from '../../src/sync/blob-repair.js';

const FAKE_MK = new Uint8Array([1, 2, 3]) as unknown as MasterKey;

function id22(seed: string): string {
  return (seed + 'A'.repeat(22)).slice(0, 22);
}

const CAPS = {
  rename: false,
  remove: false,
  copy: false,
  download: true,
  delete: false,
  editSource: false,
  editTags: false,
} as const;

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
  _resetBlobRepairForTests();
  _resetBlobFetchForTests();
  _setBlobFetchDeps({ getMk: () => FAKE_MK, invalidate: () => undefined });
  // Reduced motion → close resolves synchronously (no FLIP timer), keeping the
  // "dismiss doesn't trap" assertion deterministic.
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('reduce'),
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }));
});

afterEach(async () => {
  vi.unstubAllGlobals();
  _resetBlobFetchForTests();
  _resetBlobRepairForTests();
  await _resetClientDataDbForTests();
});

describe('Lightbox — lazy blob source (§6 detach)', () => {
  it('is dismissable mid-fetch: closing during a pending fetch never traps', async () => {
    await getClientDataDb().artefacts.put({
      id: 'a1',
      title: 'Pic',
      blobRef: { blobId: id22('lb1'), bytes: 100 },
    } as never);
    // A never-resolving fetch keeps the lightbox image in its loading ring.
    _setBlobFetchDeps({ getBlob: () => new Promise<Uint8Array>(() => {}) });

    const item: ViewableItem = {
      id: 'a1',
      kind: 'image',
      fileName: 'pic.jpg',
      mime: 'image/jpeg',
      blobSource: { collection: 'artefacts', key: 'a1', field: 'blob' },
      caps: CAPS,
    };
    const onClose = vi.fn();
    render(
      <Lightbox
        items={[item]}
        index={0}
        onRename={() => {}}
        onRemove={() => {}}
        onEditText={() => {}}
        onClose={onClose}
      />,
    );

    // The image body is a progress affordance, not a broken glyph or a trap.
    await waitFor(() => {
      expect(document.querySelector('[data-blob-state="loading"]')).not.toBeNull();
    });

    // Dismissing mid-fetch works immediately — the ring never blocks close.
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
