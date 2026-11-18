// SPDX-License-Identifier: AGPL-3.0-only
// Typed send stops on the chat page (spec 0.5.0 papercuts, item 7): where each
// note shows, that the draft survives, and that the interrupted-reply Retry
// deletes nothing when the key or the master key is missing.
import { asMasterKey, getRandomBytes } from '@chatsundere/crypto';
import { useSessionStore } from '@chatsundere/ui-shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { uuidv7 } from 'uuidv7';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nanoGpt } from '../../../../packages/llm-unified/src/providers/nano-gpt';

const { sendMutate, regenerateMutate, assertKey, opener } = vi.hoisted(() => ({
  sendMutate: vi.fn(),
  regenerateMutate: vi.fn(),
  assertKey: vi.fn(),
  opener: { isError: false, error: null as unknown },
}));

vi.mock('../../src/data/send-message.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/data/send-message.js')>();
  return {
    ...actual,
    useSendMessage: () => ({ mutateAsync: sendMutate }),
    useRegenerate: () => ({ mutateAsync: regenerateMutate }),
    useStartOpener: () => ({
      mutateAsync: vi.fn(async () => undefined),
      reset: () => undefined,
      isError: opener.isError,
      error: opener.error,
    }),
    assertPersonaKeyUsable: (...a: unknown[]) => assertKey(...a),
  };
});

import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db';
import { MasterKeyUnavailableError, ProviderKeyLockedError } from '../../src/data/send-errors';
import { sealSecret } from '../../src/lib/secrets';
import { ChatPage } from '../../src/routes/app/chat/chat-page';
import { useCurrentChatStore } from '../../src/state/current-chat.store';
import { useToastStore } from '../../src/state/toast.store';

function Landed(): JSX.Element {
  const loc = useLocation();
  return <div data-testid="landed">{`${loc.pathname}${loc.search}`}</div>;
}

function makeWrapper(qc: QueryClient, initial: string) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initial]}>
        <Routes>
          <Route path="/app/chat/new" element={children} />
          <Route path="/app/chat/:chatId" element={children} />
          <Route path="/login" element={<Landed />} />
          <Route path="/app/settings/providers/:templateId" element={<Landed />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

const offering = nanoGpt.offerings[0];

/** A persona on nano-gpt with a saved key, so the cockpit resolves its model. */
async function seedPersona() {
  if (!offering) throw new Error('nano-gpt has no offerings');
  const mk = asMasterKey(getRandomBytes(32));
  useSessionStore.setState({ mk } as never);
  const db = await openClientDataDb();
  const providerId = 'nano-gpt';
  await db.providers.add({
    id: providerId,
    templateId: 'nano-gpt',
    displayName: 'nano-gpt',
    baseUrl: nanoGpt.baseUrl,
    apiKey: await sealSecret('test-key', mk, `provider/${providerId}/api-key`),
    routing: { kind: 'direct' },
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
  });
  const personaId = uuidv7();
  await db.personas.add({
    id: personaId,
    name: 'Aurum',
    tagline: '',
    colour: '#c9a84c',
    font: 'serif',
    instructions: 'Test persona.',
    canonicalId: null,
    providerId,
    modelId: offering.upstreamSlug,
    mindspaceId: null,
    aboutMeOverride: null,
    textureOverride: null,
    temperature: 0.85,
    adultPersona: false,
    chatsundereTonality: true,
    contextWindow: null,
    libraryIds: [],
    askExpertDefault: false,
    mcpOverrides: {},
    roleplay: false,
    narration: 'first',
    greetingEnabled: false,
    greetingInstructions: '',
    voice: null,
    narratorVoice: null,
    createdAt: 1,
    updatedAt: 1,
  });
  return { db, personaId };
}

async function seedChat(
  personaId: string,
  db: Awaited<ReturnType<typeof openClientDataDb>>,
  lastState: 'complete' | 'incomplete',
) {
  const ms = await db.mindspaces.toArray();
  const chatId = uuidv7();
  await db.chats.add({
    id: chatId,
    personaId,
    title: 'Chat',
    resolvedMindspaceId: ms[0]?.id ?? 'm1',
    createdAt: 1,
    updatedAt: 1,
    lastMessageAt: 3,
    bookmarkedMessageCount: 0,
    draftInput: '',
    libraryIds: [],
  });
  const userId = uuidv7();
  const replyId = uuidv7();
  await db.messages.bulkAdd([
    {
      id: userId,
      chatId,
      role: 'user',
      contentBlocks: [{ type: 'text', text: 'my precious words' }],
      createdAt: 2,
      updatedAt: 2,
      bookmarked: false,
      streamingState: 'complete',
    },
    {
      id: replyId,
      chatId,
      role: 'persona',
      contentBlocks: [{ type: 'text', text: 'a reply' }],
      createdAt: 3,
      updatedAt: 3,
      bookmarked: false,
      streamingState: lastState,
    },
  ]);
  return { chatId, userId, replyId };
}

function newQc() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

beforeEach(async () => {
  // The lazy route reads the per-persona draft from localStorage, which this
  // jsdom build does not provide (same stub as chat-page.test.tsx).
  if (typeof globalThis.localStorage === 'undefined') {
    const store = new Map<string, string>();
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => store.set(k, String(v)),
        removeItem: (k: string) => store.delete(k),
        clear: () => store.clear(),
      },
    });
  }
  await _resetClientDataDbForTests({ keepData: false });
  useCurrentChatStore.getState().reset();
  sendMutate.mockReset();
  regenerateMutate.mockReset();
  assertKey.mockReset().mockResolvedValue(undefined);
  opener.isError = false;
  opener.error = null;
  useToastStore.getState().clear();
});

afterEach(async () => {
  await _resetClientDataDbForTests({ keepData: false });
  useSessionStore.setState({ mk: null, session: null });
  // biome-ignore lint/performance/noDelete: test teardown removing a global stub — perf is irrelevant
  delete (globalThis as { localStorage?: unknown }).localStorage;
  vi.restoreAllMocks();
});

describe('ChatPage — typed send stops', () => {
  it('send: a locked key shows the cockpit note with Re-enter key and keeps the draft', async () => {
    const { personaId } = await seedPersona();
    sendMutate.mockRejectedValue(new ProviderKeyLockedError('nano-gpt', 'NanoGPT'));
    const path = `/app/chat/new?personaId=${personaId}`;
    const { container } = render(<ChatPage />, { wrapper: makeWrapper(newQc(), path) });

    const input = await waitFor(() => {
      const el = container.querySelector<HTMLTextAreaElement>('textarea.cockpit-input');
      if (!el) throw new Error('cockpit input not yet rendered');
      return el;
    });
    fireEvent.change(input, { target: { value: 'keep me' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Send' }));

    const note = await screen.findByText(
      "Your saved key for NanoGPT can't be opened any more. Enter it again to keep chatting.",
    );
    const slot = note.closest('[role="alert"]') as HTMLElement;
    expect(within(slot).getByRole('button', { name: 'Dismiss' })).toBeInTheDocument();
    expect(input.value).toBe('keep me');

    fireEvent.click(within(slot).getByRole('button', { name: 'Re-enter key' }));
    expect(await screen.findByTestId('landed')).toHaveTextContent(
      `/app/settings/providers/nano-gpt?return=${encodeURIComponent(path)}&focus=key`,
    );
  });

  it('send: no master key shows the passphrase note, and Dismiss clears it', async () => {
    const { personaId } = await seedPersona();
    sendMutate.mockRejectedValue(new MasterKeyUnavailableError('useSendMessage'));
    const { container } = render(<ChatPage />, {
      wrapper: makeWrapper(newQc(), `/app/chat/new?personaId=${personaId}`),
    });
    const input = await waitFor(() => {
      const el = container.querySelector<HTMLTextAreaElement>('textarea.cockpit-input');
      if (!el) throw new Error('cockpit input not yet rendered');
      return el;
    });
    fireEvent.change(input, { target: { value: 'hello' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Send' }));
    const note = await screen.findByText(
      'Chatsundere needs your passphrase once more before it can use your keys.',
    );
    const slot = note.closest('[role="alert"]') as HTMLElement;
    expect(within(slot).getByRole('button', { name: 'Enter passphrase' })).toBeInTheDocument();
    fireEvent.click(within(slot).getByRole('button', { name: 'Dismiss' }));
    await waitFor(() =>
      expect(
        screen.queryByText(
          'Chatsundere needs your passphrase once more before it can use your keys.',
        ),
      ).toBeNull(),
    );
    expect(input.value).toBe('hello');
  });

  it('regenerate in reading mode: an in-stream notice under the reply, no cockpit needed', async () => {
    const { db, personaId } = await seedPersona();
    const { chatId } = await seedChat(personaId, db, 'complete');
    regenerateMutate.mockRejectedValue(new MasterKeyUnavailableError('useRegenerate'));
    const { container } = render(<ChatPage />, {
      wrapper: makeWrapper(newQc(), `/app/chat/${chatId}`),
    });
    const reply = await waitFor(() => {
      const el = container.querySelector<HTMLElement>('.msg.from-persona');
      if (!el) throw new Error('reply not yet rendered');
      return el;
    });
    expect(useCurrentChatStore.getState().isInteractionMode).toBe(false);
    fireEvent.click(reply);
    fireEvent.click(await screen.findByRole('button', { name: /Regenerate/ }));

    const notice = await screen.findByRole('alert');
    expect(notice).toHaveTextContent(
      'Chatsundere needs your passphrase once more before it can use your keys.',
    );
    expect(container.querySelector('.cockpit-input')).toBeNull();
    fireEvent.click(within(notice).getByRole('link', { name: 'Enter passphrase' }));
    expect(await screen.findByTestId('landed')).toHaveTextContent(
      `/login?return=${encodeURIComponent(`/app/chat/${chatId}`)}&need=passphrase`,
    );
  });

  it('interrupted-reply Retry: a typed stop deletes nothing and shows the notice', async () => {
    const { db, personaId } = await seedPersona();
    const { chatId, userId, replyId } = await seedChat(personaId, db, 'incomplete');
    assertKey.mockRejectedValue(new ProviderKeyLockedError('nano-gpt', 'NanoGPT'));
    render(<ChatPage />, { wrapper: makeWrapper(newQc(), `/app/chat/${chatId}`) });

    fireEvent.click(await screen.findByRole('button', { name: /Retry/ }));
    expect(
      await screen.findByText(
        "Your saved key for NanoGPT can't be opened any more. Enter it again to keep chatting.",
      ),
    ).toBeInTheDocument();
    expect(assertKey).toHaveBeenCalledWith(chatId);
    expect(sendMutate).not.toHaveBeenCalled();
    expect(await db.messages.get(userId)).toBeDefined();
    expect(await db.messages.get(replyId)).toBeDefined();
    expect(await db.syncOutbox.count()).toBe(0);
  });

  it('interrupted-reply Retry still deletes and resends when the key opens', async () => {
    const { db, personaId } = await seedPersona();
    const { chatId, userId, replyId } = await seedChat(personaId, db, 'incomplete');
    sendMutate.mockResolvedValue(chatId);
    render(<ChatPage />, { wrapper: makeWrapper(newQc(), `/app/chat/${chatId}`) });

    fireEvent.click(await screen.findByRole('button', { name: /Retry/ }));
    await waitFor(() => expect(sendMutate).toHaveBeenCalledTimes(1));
    expect(sendMutate.mock.calls[0]?.[0]).toMatchObject({ chatId, text: 'my precious words' });
    expect(await db.messages.get(userId)).toBeUndefined();
    expect(await db.messages.get(replyId)).toBeUndefined();
  });

  /** Wire the mocked pre-flight to the real one, so it runs the send's resolution. */
  async function useRealPreflight(): Promise<void> {
    const actual = await vi.importActual<typeof import('../../src/data/send-message.js')>(
      '../../src/data/send-message.js',
    );
    assertKey.mockImplementation((id: string) => actual.assertPersonaKeyUsable(id));
  }

  for (const [label, breakIt] of [
    [
      'the offering is missing',
      async (db: Awaited<ReturnType<typeof openClientDataDb>>, personaId: string) => {
        await db.personas.update(personaId, { modelId: 'no-such-model' });
      },
    ],
    [
      'the provider row is gone',
      async (db: Awaited<ReturnType<typeof openClientDataDb>>) => {
        await db.providers.delete('nano-gpt');
      },
    ],
  ] as const) {
    it(`interrupted-reply Retry deletes nothing when ${label}`, async () => {
      const { db, personaId } = await seedPersona();
      const { chatId, userId, replyId } = await seedChat(personaId, db, 'incomplete');
      await breakIt(db, personaId);
      await useRealPreflight();
      render(<ChatPage />, { wrapper: makeWrapper(newQc(), `/app/chat/${chatId}`) });

      fireEvent.click(await screen.findByRole('button', { name: /Retry/ }));
      await waitFor(() =>
        expect(useToastStore.getState().toasts.map((t) => t.message)).toContain(
          "Couldn't retry just now — your message is kept.",
        ),
      );
      expect(sendMutate).not.toHaveBeenCalled();
      expect(await db.messages.get(userId)).toBeDefined();
      expect(await db.messages.get(replyId)).toBeDefined();
      expect(await db.syncOutbox.count()).toBe(0);
    });
  }

  it('opener: the greeting notice carries the cause and the action in place of Retry', async () => {
    const { db, personaId } = await seedPersona();
    const ms = await db.mindspaces.toArray();
    const chatId = uuidv7();
    await db.chats.add({
      id: chatId,
      personaId,
      title: null,
      resolvedMindspaceId: ms[0]?.id ?? 'm1',
      createdAt: 1,
      updatedAt: 1,
      lastMessageAt: 1,
      bookmarkedMessageCount: 0,
      draftInput: '',
      libraryIds: [],
    });
    opener.isError = true;
    opener.error = new ProviderKeyLockedError('nano-gpt', 'NanoGPT');
    render(<ChatPage />, { wrapper: makeWrapper(newQc(), `/app/chat/${chatId}`) });

    expect(await screen.findByText("Aurum couldn't compose the greeting")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Your saved key for NanoGPT can't be opened any more. Enter it again to keep chatting.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Retry/ })).toBeNull();
    expect(screen.getByRole('link', { name: 'Re-enter key' })).toHaveAttribute(
      'href',
      `/app/settings/providers/nano-gpt?return=${encodeURIComponent(`/app/chat/${chatId}`)}&focus=key`,
    );
  });

  it('opener: any other failure keeps the plain notice with Retry', async () => {
    const { db, personaId } = await seedPersona();
    const ms = await db.mindspaces.toArray();
    const chatId = uuidv7();
    await db.chats.add({
      id: chatId,
      personaId,
      title: null,
      resolvedMindspaceId: ms[0]?.id ?? 'm1',
      createdAt: 1,
      updatedAt: 1,
      lastMessageAt: 1,
      bookmarkedMessageCount: 0,
      draftInput: '',
      libraryIds: [],
    });
    opener.isError = true;
    opener.error = new Error('upstream 500');
    render(<ChatPage />, { wrapper: makeWrapper(newQc(), `/app/chat/${chatId}`) });
    expect(await screen.findByText("Aurum couldn't compose the greeting")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Retry/ })).toBeInTheDocument();
  });
});
