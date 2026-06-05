// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db';
import { MessageBlock } from '../../src/components/chat/MessageBlock';
import { addAttachment, attachPendingToMessage } from '../../src/data/attachments';

function wrap(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

beforeEach(async () => {
  await _resetClientDataDbForTests({ keepData: false });
  await openClientDataDb();
});

describe('MessageBlock attachments', () => {
  it('renders an attachment strip under a user message that has attachments', async () => {
    await addAttachment({
      chatId: 'c1',
      kind: 'text',
      fileName: 'n.md',
      mime: 'text/markdown',
      text: '# x',
    });
    await attachPendingToMessage('c1', 'm1');
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const message = {
      id: 'm1',
      chatId: 'c1',
      role: 'user',
      contentBlocks: [{ type: 'text', text: 'hi' }],
      createdAt: 0,
      bookmarked: false,
      streamingState: 'complete',
    } as never;
    const { getByText } = render(
      <MessageBlock
        message={message}
        pills={new Map()}
        persona={null}
        mindspace={{} as never}
        displayName="me"
        expanded={false}
        onToggleExpand={() => {}}
        onCopy={() => {}}
        onBookmark={() => {}}
      />,
      { wrapper: wrap(qc) },
    );
    await waitFor(() => expect(getByText('n.md')).toBeTruthy());
  });
});
