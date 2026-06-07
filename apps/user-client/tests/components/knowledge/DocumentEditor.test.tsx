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
});
