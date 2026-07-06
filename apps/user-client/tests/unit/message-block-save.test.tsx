// SPDX-License-Identifier: AGPL-3.0-only
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import 'fake-indexeddb/auto';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db.js';
import type { MessageRow, PersonaRow } from '../../src/boot/client-data-db.js';
import { MessageBlock } from '../../src/components/chat/MessageBlock.js';
import { listChatArtefacts } from '../../src/data/artefacts.js';
import type { ResolvedMindspace } from '../../src/state/mindspace-resolver.js';
import { useToastStore } from '../../src/state/toast.store.js';

const mindspaceStub = {} as ResolvedMindspace;
function wrapper({ children }: { children: ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}
const persona = { id: 'p1', name: 'Aurum', font: 'serif', colour: '#c9a84c' } as PersonaRow;
function personaMsg(over: Partial<MessageRow> = {}): MessageRow {
  return {
    id: 'm-p',
    chatId: 'c1',
    role: 'persona',
    contentBlocks: [{ type: 'text', text: 'A thoughtful reply.' }],
    createdAt: 2,
    updatedAt: 2,
    bookmarked: false,
    streamingState: 'complete',
    ...over,
  };
}

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
  useToastStore.getState().clear();
});
afterEach(async () => {
  await _resetClientDataDbForTests();
});

test('saving a message persists a markdown artefact and shows a toast', async () => {
  render(
    <MessageBlock
      message={personaMsg()}
      pills={new Map()}
      mindspace={mindspaceStub}
      persona={persona}
      displayName="Chris"
      expanded={true}
      onToggleExpand={vi.fn()}
      onCopy={vi.fn()}
      onBookmark={vi.fn()}
    />,
    { wrapper },
  );
  fireEvent.click(screen.getByRole('button', { name: /Save/ }));
  await vi.waitFor(async () => {
    const rows = await listChatArtefacts('c1');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ origin: 'saved-message', format: 'markdown' });
  });
  expect(useToastStore.getState().toasts.some((t) => t.message.startsWith('Saved'))).toBe(true);
});

test('Save is disabled for a text-less message', () => {
  render(
    <MessageBlock
      message={personaMsg({ contentBlocks: [{ type: 'pill', pillId: 'x' }] })}
      pills={new Map()}
      mindspace={mindspaceStub}
      persona={persona}
      displayName="Chris"
      expanded={true}
      onToggleExpand={vi.fn()}
      onCopy={vi.fn()}
      onBookmark={vi.fn()}
    />,
    { wrapper },
  );
  expect(screen.getByRole('button', { name: /Save/ })).toBeDisabled();
});
