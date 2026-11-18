// SPDX-License-Identifier: AGPL-3.0-only
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import 'fake-indexeddb/auto';
import {
  type MessageRow,
  _resetClientDataDbForTests,
  openClientDataDb,
} from '../../../src/boot/client-data-db.js';

const deliverFile = vi.fn();
vi.mock('../../../src/lib/share-or-download.js', () => ({ deliverFile }));
const show = vi.fn();
vi.mock('../../../src/state/toast.store.js', () => ({ toastStore: { show } }));

const { useChatExport } = await import('../../../src/routes/app/chat/use-chat-export.js');

function wrapper(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

// jsdom's File has no text(); FileReader is what it does implement.
function readText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

const T0 = new Date(2026, 10, 14, 18, 3).getTime();

function message(id: string, over: Partial<MessageRow> = {}): MessageRow {
  return {
    id,
    chatId: 'c1',
    role: 'persona',
    contentBlocks: [{ type: 'text', text: `Text of ${id}.` }],
    createdAt: T0,
    updatedAt: T0,
    bookmarked: false,
    streamingState: 'complete',
    ...over,
  };
}

async function seed(messages: MessageRow[]): Promise<void> {
  const db = await openClientDataDb();
  await db.chats.add({
    id: 'c1',
    personaId: 'p1',
    title: 'Trip planning',
    resolvedMindspaceId: 'ms1',
    createdAt: T0,
    updatedAt: T0,
    lastMessageAt: T0,
    bookmarkedMessageCount: 0,
    draftInput: '',
    libraryIds: [],
  });
  if (messages.length > 0) await db.messages.bulkAdd(messages);
}

type Args = Parameters<typeof useChatExport>[0];
const base: Args = {
  open: true,
  chatId: 'c1',
  personaName: 'Mira',
  userName: 'Chris',
  streamingMessageId: null,
};

function mount(args: Partial<Args> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return renderHook((a: Args) => useChatExport(a), {
    wrapper: wrapper(qc),
    initialProps: { ...base, ...args },
  });
}

beforeEach(async () => {
  await _resetClientDataDbForTests({ keepData: false });
  deliverFile.mockReset();
  show.mockReset();
});
afterEach(async () => {
  await _resetClientDataDbForTests({ keepData: false });
});

describe('useChatExport', () => {
  it('is empty for a lazy chat without loading anything', () => {
    const { result } = mount({ chatId: null });
    expect(result.current.exportState).toBe('empty');
  });

  it('is preparing until the rows are in, then ready', async () => {
    await seed([message('m1')]);
    const { result } = mount();
    expect(result.current.exportState).toBe('preparing');
    await waitFor(() => expect(result.current.exportState).toBe('ready'));
  });

  it('is empty for a saved chat without messages', async () => {
    await seed([]);
    const { result } = mount();
    await waitFor(() => expect(result.current.exportState).toBe('empty'));
  });

  it('reports streaming while a reply streams after other messages', async () => {
    await seed([message('m1'), message('m2', { createdAt: T0 + 1 })]);
    const { result } = mount({ streamingMessageId: 'm2' });
    await waitFor(() => expect(result.current.exportState).toBe('streaming'));
  });

  it('is empty when the streaming reply is the only message', async () => {
    await seed([message('m1', { streamingState: 'incomplete' })]);
    const { result } = mount({ streamingMessageId: 'm1' });
    await waitFor(() => expect(result.current.exportState).toBe('empty'));
  });

  it('does not load while the menu is closed', async () => {
    await seed([message('m1')]);
    const { result } = mount({ open: false });
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.exportState).toBe('preparing');
  });

  it('builds the file synchronously in the tap and toasts after a download', async () => {
    await seed([message('m1')]);
    deliverFile.mockResolvedValue('downloaded');
    const { result } = mount();
    await waitFor(() => expect(result.current.exportState).toBe('ready'));
    act(() => result.current.onExport());
    expect(deliverFile).toHaveBeenCalledTimes(1);
    const [file, title] = deliverFile.mock.calls[0] as [File, string];
    expect(file.name).toBe('mira-trip-planning-2026-11-14.md');
    expect(file.type).toBe('text/markdown');
    expect(title).toBe('Trip planning');
    const text = await readText(file);
    expect(text).toContain('# Trip planning');
    expect(text).toContain('Text of m1.');
    await waitFor(() =>
      expect(show).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Chat exported', tone: 'success' }),
      ),
    );
  });

  it('stays silent after a share or a cancelled share', async () => {
    await seed([message('m1')]);
    const { result } = mount();
    await waitFor(() => expect(result.current.exportState).toBe('ready'));
    for (const outcome of ['shared', 'cancelled']) {
      deliverFile.mockResolvedValueOnce(outcome);
      await act(async () => result.current.onExport());
    }
    expect(deliverFile).toHaveBeenCalledTimes(2);
    expect(show).not.toHaveBeenCalled();
  });

  it('toasts the failure when delivery fails', async () => {
    await seed([message('m1')]);
    deliverFile.mockRejectedValue(new Error('blocked'));
    const { result } = mount();
    await waitFor(() => expect(result.current.exportState).toBe('ready'));
    await act(async () => result.current.onExport());
    expect(show).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Couldn't export this chat", tone: 'warn' }),
    );
  });

  it('toasts the failure when the rows are not there to build from', () => {
    const { result } = mount({ open: false });
    act(() => result.current.onExport());
    expect(deliverFile).not.toHaveBeenCalled();
    expect(show).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Couldn't export this chat", tone: 'warn' }),
    );
  });

  it('toasts the failure when loading fails, without disabling the entry', async () => {
    // No openClientDataDb: the loader throws on the closed database.
    const { result } = mount();
    await waitFor(() => expect(result.current.exportState).toBe('ready'));
    act(() => result.current.onExport());
    expect(show).toHaveBeenCalledWith(
      expect.objectContaining({ message: "Couldn't export this chat", tone: 'warn' }),
    );
  });
});
