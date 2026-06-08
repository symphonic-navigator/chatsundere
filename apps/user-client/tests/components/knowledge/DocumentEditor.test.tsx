import 'fake-indexeddb/auto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../../src/boot/client-data-db.js';
import { DocumentEditor } from '../../../src/components/knowledge/DocumentEditor.js';

const enqueue = vi.fn();
vi.mock('../../../src/knowledge/start-ingestion.js', () => ({
  enqueueDocument: (id: string) => enqueue(id),
}));

beforeEach(async () => {
  await openClientDataDb();
  enqueue.mockClear();
  await getClientDataDb().documents.add({
    id: 'd1',
    libraryId: 'lib1',
    title: 'Geo',
    content: 'old',
    embeddingStatus: 'ready',
    embeddingError: null,
    chunkCount: 1,
    triggerPhrases: [],
    createdAt: 1,
    updatedAt: 1,
  });
});
afterEach(async () => {
  await _resetClientDataDbForTests({ keepData: false });
});

function wrap() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DocumentEditor libraryId="lib1" documentId="d1" onClose={() => {}} />
    </QueryClientProvider>,
  );
}

describe('DocumentEditor', () => {
  it('loads existing content and re-embeds on a content save', async () => {
    wrap();
    const content = (await screen.findByLabelText(/content/i)) as HTMLTextAreaElement;
    expect(content.value).toBe('old');
    fireEvent.change(content, { target: { value: 'new body' } });
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() =>
      expect(getClientDataDb().documents.get('d1')).resolves.toMatchObject({
        content: 'new body',
        embeddingStatus: 'pending',
      }),
    );
    expect(enqueue).toHaveBeenCalledWith('d1');
  });

  it('edits trigger phrases and the companion toggle without re-embedding', async () => {
    wrap();
    // Wait for the component to load.
    await screen.findByLabelText(/content/i);

    // The companion toggle is disabled until a phrase exists.
    const toggle = screen.getByLabelText(/companion/i);
    expect(toggle).toBeDisabled();

    // Add a phrase via the chip editor (double space → collapsed to single space).
    const input = screen.getByPlaceholderText('Add a tag…');
    fireEvent.change(input, { target: { value: 'Red  Dragon' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText('#red dragon')).toBeInTheDocument();

    // Now the toggle is enabled; turn it on.
    expect(toggle).toBeEnabled();
    fireEvent.click(toggle);

    // Save → persists normalised phrases + toggle, stays ready (no content change).
    fireEvent.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(async () => {
      const row = await getClientDataDb().documents.get('d1');
      expect(row?.triggerPhrases).toEqual(['red dragon']);
      expect(row?.triggerOnCompanion).toBe(true);
      expect(row?.embeddingStatus).toBe('ready');
    });
    expect(enqueue).not.toHaveBeenCalled();
  });
});
