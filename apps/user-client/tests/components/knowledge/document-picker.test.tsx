// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../../src/boot/client-data-db';
import { DocumentPicker } from '../../../src/components/knowledge/DocumentPicker';
import { listPendingAttachments } from '../../../src/data/attachments';
import { addDocuments, createLibrary } from '../../../src/data/knowledge';

vi.mock('../../../src/knowledge/start-ingestion.js', () => ({ enqueueDocument: () => {} }));

function wrap(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

beforeEach(async () => {
  await _resetClientDataDbForTests({ keepData: false });
  await openClientDataDb();
});

async function seed() {
  const sfw = await createLibrary({ name: 'Work', description: '', nsfw: false });
  await addDocuments(sfw.id, [
    { title: 'Brand', content: 'brand body' },
    { title: 'Palette', content: 'palette body' },
  ]);
  const nsfw = await createLibrary({ name: 'Private', description: '', nsfw: true });
  await addDocuments(nsfw.id, [{ title: 'Secret', content: 'secret body' }]);
  return { sfw, nsfw };
}

describe('DocumentPicker', () => {
  it('expands a library inline and attaches selected documents as references', async () => {
    await seed();
    // Default adultMode is 'nsfw' — force SFW so the NSFW library is hidden,
    // mirroring the ArtefactPicker NSFW-filtering test pattern.
    await getClientDataDb().settings.update(1, { adultMode: 'sfw' });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const onClose = vi.fn();
    const { findByText, getByText, container } = render(
      <DocumentPicker chatId="c1" onClose={onClose} />,
      { wrapper: wrap(qc) },
    );

    // SFW mode → the NSFW library is hidden.
    await findByText('Work');
    expect(container.textContent).not.toContain('Private');

    fireEvent.click(getByText('Work')); // expand the accordion group
    const brand = await findByText('Brand.md');
    fireEvent.click(brand);
    fireEvent.click(container.querySelector('.document-picker-attach') as HTMLElement);

    await waitFor(async () => {
      const pending = await listPendingAttachments('c1');
      expect(pending.map((p) => p.fileName)).toEqual(['Brand.md']);
      expect(pending[0]?.origin).toBe('library');
      expect(pending[0]?.text).toBeUndefined();
    });
    expect(onClose).toHaveBeenCalled();
  });
});
