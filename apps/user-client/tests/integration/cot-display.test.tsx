import { getOffering } from '@chatsundere/llm-unified';
// SPDX-License-Identifier: AGPL-3.0-only
//
// End-to-end Chain-of-Thought display integration.
//
// This test exercises the FULL CoT pipeline by:
//   1. Mocking `streamCompletion` at the package boundary so we control the
//      chunk stream without any network or SSE parsing.
//   2. Driving `useStreamManagerStore.start(...)` directly with a fabricated
//      args bundle — that calls the real `runStreamEngine`, which iterates
//      our mocked chunks, mirrors reasoning + tokens into the live buffer,
//      coalesces on finalise, persists to Dexie, and rotates the handle.
//   3. Mounting `<ChatStream>` (the real component, with real `<MessageBlock>`
//      and `<ReasoningPill>`) inside a TestHost that reads the chat back via
//      `useChat()` so React-Query invalidation drives re-render after the
//      user-msg / draft-msg are inserted, after every reasoning chunk
//      (handle ref rotation), and after finalise.
//
// We deliberately bypass `useSendMessage` / `<ChatPage>` here. That layer
// adds provider lookup, sealed-secret decryption, master-key seeding, and
// settings reads — none of which are part of the CoT-display contract. The
// task brief explicitly OKs this simpler integration scope: the goal is
// end-to-end verification of the reasoning pipeline, not specifically
// ChatPage.
//
// Three assertions form the contract:
//   • While streaming: a ReasoningPill is present with `data-live="true"`.
//   • After finalise: the same pill is present with `data-live="false"`.
//   • Clicking the pill expands it; the open body contains the coalesced
//     reasoning trace, and the persona answer text is visible alongside.
import { QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { act, render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { type ReactNode, useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nanoGpt } from '../../../../packages/llm-unified/src/providers/nano-gpt';
import {
  type ChatRow,
  type MessageRow,
  type PersonaRow,
  _resetClientDataDbForTests,
  openClientDataDb,
} from '../../src/boot/client-data-db';
import { ChatStream } from '../../src/components/chat/ChatStream';
import { useChat } from '../../src/data/chats';
// IMPORTANT: stream-manager invalidates via the singleton queryClient from
// `src/lib/queryClient`, not via React context. We must reuse the same
// instance in the QueryClientProvider so `useChat()` in TestHost sees the
// invalidations fired by the stream-manager after finalise.
import { queryClient } from '../../src/lib/queryClient';
import { useCurrentChatStore } from '../../src/state/current-chat.store';
import { useStreamManagerStore } from '../../src/state/stream-manager.store';

// Mock streamCompletion at the package boundary BEFORE any consumer imports
// it. The mocked generator awaits between chunks so React has the chance
// to commit re-renders mid-stream — without the awaits, the entire stream
// would burn through in one microtask tick and the test would never observe
// the live pill state.
vi.mock('@chatsundere/llm-unified', async (orig) => {
  const real = (await orig()) as Record<string, unknown>;
  return {
    ...real,
    streamCompletion: vi.fn().mockImplementation(async function* () {
      await new Promise((r) => setTimeout(r, 5));
      yield { type: 'reasoning', text: 'considering options' };
      await new Promise((r) => setTimeout(r, 20));
      yield { type: 'reasoning', text: ' and weighing them' };
      await new Promise((r) => setTimeout(r, 20));
      yield { type: 'token', text: 'Hi there.' };
      await new Promise((r) => setTimeout(r, 5));
      yield { type: 'finish', reason: 'stop' };
    }),
  };
});

// ─── Test wrapper ────────────────────────────────────────────────────────────
//
// TestHost: subscribes to `useChat()` for messages + pills, to
// `useStreamManagerStore` for the live handle, and forwards both into
// `<ChatStream>`. Mirrors the slice of ChatPage that matters for the
// CoT-display surface; everything else (cockpit, persona greeting,
// stream-interrupted footer) is irrelevant here.
function TestHost({
  chatId,
  persona,
}: {
  chatId: string;
  persona: PersonaRow;
}): JSX.Element | null {
  const chatQuery = useChat(chatId);
  const qc = useQueryClient();
  const streamHandle = useStreamManagerStore((s) => s.streams.get(chatId) ?? null);

  // After `start()` inserts the user-msg + draft synchronously, React-Query
  // has no signal to refetch — its cache still has the pre-start (empty)
  // result. Invalidating once on first paint catches the freshly-inserted
  // rows so the draft enters `messages` and `<ChatStream>` can mirror the
  // live buffer onto it.
  useEffect(() => {
    void qc.invalidateQueries({ queryKey: ['chats', chatId] });
  }, [qc, chatId]);

  if (!chatQuery.data) return null;
  return (
    <ChatStream
      chatId={chatId}
      messages={chatQuery.data.messages}
      pills={chatQuery.data.pills}
      persona={persona}
      displayName="Chris"
      streamHandle={streamHandle}
    />
  );
}

// ─── Fixture helpers ─────────────────────────────────────────────────────────

// Unique IDs prevent collisions with the 200 ms-deferred handle cleanup
// from any pre-existing tests in the same module / suite (see the
// stream-manager-store.test.ts comment block on test-env leaks).
const IT_PERSONA_ID = 'it-persona-1';
const IT_CHAT_ID = 'it-chat-1';

async function seedFixtures(): Promise<{ persona: PersonaRow; chat: ChatRow }> {
  const db = await openClientDataDb();
  const persona: PersonaRow = {
    id: IT_PERSONA_ID,
    name: 'Aurum',
    tagline: '',
    colour: '#c9a84c',
    font: 'serif',
    // buildPrompt rejects empty persona instructions, so any
    // non-trivial string keeps the engine happy.
    instructions: 'You are Aurum.',
    canonicalId: null,
    providerId: 'pr-it',
    modelId: nanoGpt.offerings[0]?.upstreamSlug ?? '',
    mindspaceId: null,
    aboutMeOverride: null,
    textureOverride: null,
    temperature: 0.85,
    adultPersona: false,
    chatsundereTonality: true,
    contextWindow: null,
    libraryIds: [],
    createdAt: 1,
    updatedAt: 1,
  };
  const chat: ChatRow = {
    id: IT_CHAT_ID,
    personaId: IT_PERSONA_ID,
    title: null,
    resolvedMindspaceId: 'm1',
    createdAt: 1,
    lastMessageAt: 1,
    bookmarkedMessageCount: 0,
    draftInput: '',
    libraryIds: [],
  };
  await db.personas.add(persona);
  await db.chats.add(chat);
  return { persona, chat };
}

function startArgs(persona: PersonaRow, chat: ChatRow): Record<string, unknown> {
  const firstOffering = nanoGpt.offerings[0];
  if (!firstOffering) throw new Error('nano-gpt has no offerings');
  const offering = getOffering('nano-gpt', firstOffering.upstreamSlug);
  if (!offering) throw new Error(`no offering for nano-gpt / ${firstOffering.upstreamSlug}`);
  return {
    chatId: chat.id,
    userText: 'Hello',
    chat,
    persona,
    provider: nanoGpt,
    providerConfig: { baseUrl: nanoGpt.baseUrl, routing: { kind: 'direct' } as const },
    apiKey: 'not-used-because-stream-is-mocked',
    corsProxyUrl: null,
    corsProxyKey: null,
    offering,
    priorMessages: [] as MessageRow[],
    userMessageText: 'Hello',
    reasoning: { kind: 'on' as const },
    globalInstructions: '',
    globalAboutMe: '',
  };
}

function wrap(): (p: { children: ReactNode }) => JSX.Element {
  return ({ children }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

beforeEach(async () => {
  await _resetClientDataDbForTests({ keepData: false });
  useStreamManagerStore.setState({ streams: new Map() });
  useCurrentChatStore.getState().reset();
  // The singleton queryClient is shared across tests — clearing it keeps
  // cross-test isolation honest. (We can't swap it out because the
  // stream-manager imports it directly.)
  queryClient.clear();
});

afterEach(async () => {
  // Drain any handles still mid-cleanup (the 200 ms setTimeout in
  // stream-manager) so they don't leak into the next test.
  useStreamManagerStore.setState({ streams: new Map() });
  await _resetClientDataDbForTests({ keepData: false });
  queryClient.clear();
  vi.restoreAllMocks();
});

// ─── Test ────────────────────────────────────────────────────────────────────

describe('CoT display — end-to-end', () => {
  it('renders a live reasoning pill during stream, flips to static after finalise, expands to the coalesced trace', async () => {
    const user = userEvent.setup();
    const { persona, chat } = await seedFixtures();

    const { container } = render(<TestHost chatId={chat.id} persona={persona} />, {
      wrapper: wrap(),
    });

    // Kick the stream. start() synchronously inserts user-msg + draft and
    // creates the handle; the engine then pumps reasoning chunks on a
    // microtask schedule (each separated by a small setTimeout in the mock).
    await act(async () => {
      await useStreamManagerStore.getState().start(startArgs(persona, chat) as never);
    });

    // ── (1) Live phase — pill is present with data-live="true" ───────────
    //
    // The pill appears once: the stream-manager has rotated the handle for
    // the first reasoning chunk, ChatStream mirrors the buffer onto the
    // draft, and MessageBlock renders the last reasoning group as live.
    await waitFor(
      () => {
        const pill = container.querySelector('.reasoning-pill') as HTMLElement | null;
        expect(pill).not.toBeNull();
        expect(pill?.getAttribute('data-live')).toBe('true');
      },
      { timeout: 1500 },
    );

    // ── (2) Static phase — same pill, now data-live="false" ──────────────
    //
    // After the engine consumes the `finish` chunk and runStreamEngine
    // resolves, stream-manager updates the DB with coalesced final blocks
    // and invalidates the chat query. The draft-id no longer matches an
    // active handle (it's deleted 200 ms later), so isStreamingDraft is
    // false and isLive is false.
    await waitFor(
      () => {
        const pill = container.querySelector('.reasoning-pill') as HTMLElement | null;
        expect(pill).not.toBeNull();
        expect(pill?.getAttribute('data-live')).toBe('false');
      },
      { timeout: 3000 },
    );

    // ── (3) Open phase — clicking reveals the coalesced trace ────────────
    //
    // Engine-side coalescing joined the two reasoning chunks into a single
    // `{type: 'reasoning', text: 'considering options and weighing them'}`
    // block. The pill body renders that text verbatim. The persona answer
    // text is also visible above/around the pill.
    const pill = container.querySelector('.reasoning-pill') as HTMLElement;
    await user.click(pill);

    const body = container.querySelector('.reasoning-pill-body') as HTMLElement | null;
    expect(body).not.toBeNull();
    expect(body?.getAttribute('aria-label')).toBe('Reasoning trace');
    expect(body?.textContent ?? '').toContain('considering options');
    expect(body?.textContent ?? '').toContain('weighing them');

    // Persona answer text — sits in the same `.msg-text` block as the pill.
    const msgText = container.querySelector('.msg.from-persona .msg-text');
    expect(msgText?.textContent ?? '').toContain('Hi there.');

    // ── Sanity: PillRow persisted reasoning into the message DB row ──────
    //
    // The integration's structural-correctness check: the DB row now holds
    // a single coalesced reasoning block followed by the text block, per
    // stream-engine's appendReasoning / appendText contract.
    const db = await openClientDataDb();
    const msgs = await db.messages.where('chatId').equals(chat.id).sortBy('createdAt');
    const personaMsg = msgs.find((m) => m.role === 'persona');
    expect(personaMsg?.streamingState).toBe('complete');
    const reasoningBlocks = (personaMsg?.contentBlocks ?? []).filter(
      (b): b is { type: 'reasoning'; text: string } => b.type === 'reasoning',
    );
    expect(reasoningBlocks).toHaveLength(1);
    expect(reasoningBlocks[0]?.text).toBe('considering options and weighing them');
  });
});
