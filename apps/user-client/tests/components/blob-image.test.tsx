// SPDX-License-Identifier: AGPL-3.0-only
import type { MasterKey } from '@chatsundere/crypto';
import { render, screen } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { BlobImage } from '../../src/components/blob/BlobImage.js';
import { _resetBlobFetchForTests, _setBlobFetchDeps } from '../../src/sync/blob-fetch.js';
import { _resetBlobRepairForTests } from '../../src/sync/blob-repair.js';
import { BlobNotFoundError } from '../../src/sync/blob-transport.js';

const FAKE_MK = new Uint8Array([1, 2, 3]) as unknown as MasterKey;

/** A 22-char base64url blob id. */
function id22(seed: string): string {
  return (seed + 'A'.repeat(22)).slice(0, 22);
}

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
  _resetBlobRepairForTests();
  _resetBlobFetchForTests();
  _setBlobFetchDeps({ getMk: () => FAKE_MK, invalidate: () => undefined });
});

afterEach(async () => {
  _resetBlobFetchForTests();
  _resetBlobRepairForTests();
  await _resetClientDataDbForTests();
});

describe('BlobImage — terminal vs pending (§10)', () => {
  it('a terminal (oversize) blob shows the explanatory copy and NO retry', async () => {
    await getClientDataDb().artefacts.put({
      id: 'a1',
      title: 'Big',
      blobRef: { blobId: id22('ov1'), bytes: 100 },
      blobOversized: true,
    } as never);

    render(<BlobImage collection="artefacts" recordKey="a1" field="blob" alt="Big" />);

    // Await the terminal copy (only the terminal state renders it).
    expect(await screen.findByText('Image unavailable')).toBeInTheDocument();
    expect(screen.getByLabelText('Big').getAttribute('data-blob-state')).toBe('terminal');
    // The unrecoverable state must never nag with a retry.
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('a pending (dangling ref) blob shows a quiet retry affordance', async () => {
    await getClientDataDb().attachments.put({
      id: 'att1',
      chatId: 'c1',
      messageId: 'm1',
      blobRef: { blobId: id22('dang1'), bytes: 100 },
    } as never);
    _setBlobFetchDeps({
      getBlob: async () => {
        throw new BlobNotFoundError();
      },
      openBlob: async () => new Uint8Array(),
    });

    render(<BlobImage collection="attachments" recordKey="att1" field="blob" alt="Pic" />);

    // The first failure is retriable: a distinct pending frame with a retry.
    // Await the retry button (only present in the pending state, not loading).
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.getByLabelText('Pic').getAttribute('data-blob-state')).toBe('pending');
  });
});
