// apps/user-client/tests/unit/history-route.test.tsx
// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it } from 'vitest';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db';
import { HistoryPage } from '../../src/routes/app/history';

async function seed(args: { adultMode?: 'nsfw' | 'sfw' } = {}): Promise<{
  sfwId: string;
  nsfwId: string;
  chatA: string;
  chatB: string;
}> {
  const db = await openClientDataDb();
  const mindspaces = await db.mindspaces.toArray();
  const ms = mindspaces[0];
  if (!ms) throw new Error('seed: no mindspace seeded — openClientDataDb should have run');
  await db.settings.update(1, { adultMode: args.adultMode ?? 'nsfw' });

  const sfwId = uuidv7();
  const nsfwId = uuidv7();
  await db.personas.bulkAdd([
    {
      id: sfwId,
      name: 'Sage',
      tagline: '',
      colour: '#aaa',
      font: 'serif',
      instructions: '',
      canonicalId: null,
      providerId: '',
      modelId: '',
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
      createdAt: 0,
      updatedAt: 0,
    },
    {
      id: nsfwId,
      name: 'Lyra',
      tagline: '',
      colour: '#a44',
      font: 'serif',
      instructions: '',
      canonicalId: null,
      providerId: '',
      modelId: '',
      mindspaceId: null,
      aboutMeOverride: null,
      textureOverride: null,
      temperature: 0.85,
      adultPersona: true,
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
      createdAt: 0,
      updatedAt: 0,
    },
  ]);

  const chatA = uuidv7();
  const chatB = uuidv7();
  await db.chats.bulkAdd([
    {
      id: chatA,
      personaId: sfwId,
      title: 'about books',
      resolvedMindspaceId: ms.id,
      createdAt: 0,
      updatedAt: 0,
      lastMessageAt: 100,
      bookmarkedMessageCount: 0,
      draftInput: '',
      libraryIds: [],
    },
    {
      id: chatB,
      personaId: nsfwId,
      title: 'private chat',
      resolvedMindspaceId: ms.id,
      createdAt: 0,
      updatedAt: 0,
      lastMessageAt: 200,
      bookmarkedMessageCount: 0,
      draftInput: '',
      libraryIds: [],
    },
  ]);

  return { sfwId, nsfwId, chatA, chatB };
}

function renderHistory(
  initialUrl = '/app/history',
): { qc: QueryClient } & ReturnType<typeof render> {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialUrl]}>
        <Routes>
          <Route path="/app/history" element={<HistoryPage />} />
          <Route path="/app/circle" element={<div data-testid="circle" />} />
          <Route path="/app/chat/:id" element={<div data-testid="chat" />} />
          <Route path="/app/chat/new" element={<div data-testid="chat-new" />} />
          <Route path="/app" element={<div data-testid="entrance" />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...result, qc };
}

describe('HistoryPage', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('renders chats sorted by lastMessageAt desc', async () => {
    await seed();
    renderHistory();
    // findByText properly awaits the element appearing in the DOM
    await screen.findByText('private chat');
    const rows = document.querySelectorAll('[data-history-row]');
    expect(rows[0]?.textContent).toContain('private chat');
    expect(rows[1]?.textContent).toContain('about books');
  });

  it('search filters by title substring (case-insensitive)', async () => {
    await seed();
    renderHistory();
    await screen.findByText('private chat');
    const input = document.querySelector('input[type="search"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'BOOK' } });
    await waitFor(() => expect(document.querySelectorAll('[data-history-row]').length).toBe(1));
    expect(document.querySelector('[data-history-row]')?.textContent).toContain('about books');
  });

  it('persona filter narrows to one persona', async () => {
    await seed();
    renderHistory();
    await screen.findByText('private chat');
    fireEvent.click(screen.getByRole('button', { name: 'Filter by persona' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sage' }));
    await waitFor(() => expect(document.querySelectorAll('[data-history-row]').length).toBe(1));
    expect(document.querySelector('[data-history-row]')?.textContent).toContain('about books');
  });

  it('NSFW persona option + NSFW chat hidden in SFW mode', async () => {
    await seed({ adultMode: 'sfw' });
    renderHistory();
    await screen.findByText('about books');
    expect(screen.queryByText('private chat')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Filter by persona' }));
    expect(screen.queryByRole('button', { name: 'Lyra' })).toBeNull();
  });

  it('flipping nsfw → sfw auto-resets persona filter to All when the selection was NSFW', async () => {
    const { nsfwId } = await seed();
    const { qc } = renderHistory(`/app/history?personaId=${nsfwId}`);
    await screen.findByText('private chat');
    const triggerEl = () => screen.getByRole('button', { name: 'Filter by persona' });
    expect(triggerEl().textContent).toContain('Lyra');

    // Direct Dexie write bypasses the React Query mutation, so we must
    // manually invalidate the settings cache to trigger a refetch.
    const db = await openClientDataDb();
    await act(async () => {
      await db.settings.update(1, { adultMode: 'sfw' });
      await qc.invalidateQueries({ queryKey: ['settings'] });
    });
    await waitFor(() => expect(triggerEl().textContent).toContain('All personas'));
  });

  it('?personaId=<id> URL param initialises filter selection', async () => {
    const { sfwId } = await seed();
    renderHistory(`/app/history?personaId=${sfwId}`);
    await screen.findByText('about books');
    expect(screen.getByRole('button', { name: 'Filter by persona' }).textContent).toContain('Sage');
    expect(document.querySelectorAll('[data-history-row]').length).toBe(1);
  });

  it('bookmarks tab: persona filter and label search narrow the list', async () => {
    const { chatA, chatB } = await seed();
    const db = await openClientDataDb();
    await db.messages.bulkAdd([
      {
        id: 'mA',
        chatId: chatA,
        role: 'user',
        contentBlocks: [{ type: 'text', text: 'apples' }],
        createdAt: 1,
        updatedAt: 1,
        bookmarked: true,
        streamingState: 'complete',
      },
      {
        id: 'mB',
        chatId: chatB,
        role: 'user',
        contentBlocks: [{ type: 'text', text: 'oranges' }],
        createdAt: 1,
        updatedAt: 1,
        bookmarked: true,
        streamingState: 'complete',
      },
    ]);
    renderHistory();
    fireEvent.click(screen.getByRole('tab', { name: 'Bookmarks' }));
    await screen.findByText('apples');
    expect(screen.getByText('oranges')).toBeTruthy();

    // Label search.
    fireEvent.change(document.querySelector('input[type="search"]') as HTMLInputElement, {
      target: { value: 'app' },
    });
    await waitFor(() => expect(screen.queryByText('oranges')).toBeNull());
    expect(screen.getByText('apples')).toBeTruthy();

    // Clear search, then narrow by persona instead.
    fireEvent.change(document.querySelector('input[type="search"]') as HTMLInputElement, {
      target: { value: '' },
    });
    await screen.findByText('oranges');
    fireEvent.click(screen.getByRole('button', { name: 'Filter by persona' }));
    fireEvent.click(screen.getByRole('button', { name: 'Sage' }));
    await waitFor(() => expect(screen.queryByText('oranges')).toBeNull());
    expect(screen.getByText('apples')).toBeTruthy();
  });

  it('empty state — no chats at all — links to /app/circle', async () => {
    await _resetClientDataDbForTests();
    renderHistory();
    await screen.findByText(/no chats yet/i);
    const link = screen.getByText(/start a conversation/i).closest('a');
    expect(link?.getAttribute('href')).toBe('/app/circle');
  });

  it('empty state — persona-filter has no chats — links to new-chat for that persona', async () => {
    const db = await openClientDataDb();
    const personaId = uuidv7();
    await db.personas.add({
      id: personaId,
      name: 'Echo',
      tagline: '',
      colour: '#aaa',
      font: 'serif',
      instructions: '',
      canonicalId: null,
      providerId: '',
      modelId: '',
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
      createdAt: 0,
      updatedAt: 0,
    });
    renderHistory(`/app/history?personaId=${personaId}`);
    await screen.findByText(/no chats with .* yet/i);
    const link = screen.getByText(/start a new one/i).closest('a');
    expect(link?.getAttribute('href')).toBe(`/app/chat/new?personaId=${personaId}`);
  });

  it('empty state — search has no matches — offers Clear filter', async () => {
    await seed();
    renderHistory();
    await screen.findByText('private chat');
    fireEvent.change(document.querySelector('input[type="search"]') as HTMLInputElement, {
      target: { value: 'zzzzzz' },
    });
    await screen.findByText(/no chats match your search/i);

    // The search-empty state offers a Clear filter button; clicking it restores
    // the previously-hidden chats.
    const clearBtn = screen.getByRole('button', { name: /clear filter/i });
    fireEvent.click(clearBtn);
    await waitFor(() =>
      expect(document.querySelectorAll('[data-history-row]').length).toBeGreaterThan(0),
    );
  });

  it('empty state — persona filter has no chats — offers Clear filter', async () => {
    const db = await openClientDataDb();
    const personaId = uuidv7();
    await db.personas.add({
      id: personaId,
      name: 'Echo',
      tagline: '',
      colour: '#aaa',
      font: 'serif',
      instructions: '',
      canonicalId: null,
      providerId: '',
      modelId: '',
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
      createdAt: 0,
      updatedAt: 0,
    });
    // Seed a chat for a different persona so clearing the filter reveals a row.
    const otherId = uuidv7();
    await db.personas.add({
      id: otherId,
      name: 'Sage',
      tagline: '',
      colour: '#aaa',
      font: 'serif',
      instructions: '',
      canonicalId: null,
      providerId: '',
      modelId: '',
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
      createdAt: 0,
      updatedAt: 0,
    });
    const mindspaces = await db.mindspaces.toArray();
    const ms = mindspaces[0];
    if (!ms) throw new Error('seed: no mindspace seeded — openClientDataDb should have run');
    await db.chats.add({
      id: uuidv7(),
      personaId: otherId,
      title: 'about books',
      resolvedMindspaceId: ms.id,
      createdAt: 0,
      updatedAt: 0,
      lastMessageAt: 100,
      bookmarkedMessageCount: 0,
      draftInput: '',
      libraryIds: [],
    });
    renderHistory(`/app/history?personaId=${personaId}`);
    await screen.findByText(/no chats with .* yet/i);

    const clearBtn = screen.getByRole('button', { name: /clear filter/i });
    fireEvent.click(clearBtn);
    await waitFor(() =>
      expect(document.querySelectorAll('[data-history-row]').length).toBeGreaterThan(0),
    );
  });
});
