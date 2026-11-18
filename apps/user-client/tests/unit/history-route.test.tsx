// apps/user-client/tests/unit/history-route.test.tsx
// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { uuidv7 } from 'uuidv7';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db';
import {
  currentHistoryGen,
  historyReturnTarget,
  rotateHistoryGen,
} from '../../src/lib/history-return';
import { HistoryPage } from '../../src/routes/app/history';

async function addMessages(
  chatId: string,
  rows: { id: string; text: string; role?: 'user' | 'persona'; bookmarked?: boolean }[],
): Promise<void> {
  const db = await openClientDataDb();
  await db.messages.bulkAdd(
    rows.map((r, i) => ({
      id: r.id,
      chatId,
      role: r.role ?? 'persona',
      contentBlocks: [{ type: 'text' as const, text: r.text }],
      createdAt: 1_000 + i,
      updatedAt: 1_000 + i,
      bookmarked: r.bookmarked ?? false,
      streamingState: 'complete' as const,
    })),
  );
}

function typeQuery(value: string): void {
  fireEvent.change(document.querySelector('input[type="search"]') as HTMLInputElement, {
    target: { value },
  });
}

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

const searches: string[] = [];

function LocationProbe(): JSX.Element {
  const loc = useLocation();
  searches.push(loc.search);
  return (
    <>
      <div data-testid="location">{`${loc.pathname}${loc.search}`}</div>
      <div data-testid="nav-state">{JSON.stringify(loc.state ?? null)}</div>
    </>
  );
}

function renderHistory(
  initialUrl: string | { pathname: string; search?: string; state?: unknown } = '/app/history',
): { qc: QueryClient } & ReturnType<typeof render> {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const result = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[initialUrl]}>
        <LocationProbe />
        <Routes>
          <Route path="/app/history" element={<HistoryPage />} />
          <Route path="/app/persona/:id" element={<div data-testid="hub" />} />
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
    sessionStorage.clear();
    rotateHistoryGen();
    searches.length = 0;
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

  it('empty state — nothing anywhere — offers Clear search', async () => {
    await seed();
    renderHistory();
    await screen.findByText('private chat');
    typeQuery('zzzzzz');
    await screen.findByText('Nothing in your history matches "zzzzzz".');
    expect(screen.queryByRole('button', { name: 'Search all personas' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    await waitFor(() =>
      expect(document.querySelectorAll('[data-history-row]').length).toBeGreaterThan(0),
    );
  });

  it('empty state — with a persona filter — also offers Search all personas', async () => {
    const { sfwId, chatB } = await seed();
    await addMessages(chatB, [{ id: 'm1', text: 'a word only Lyra said' }]);
    renderHistory(`/app/history?personaId=${sfwId}`);
    await screen.findByText('about books');
    typeQuery('lyra said');
    await screen.findByText('Nothing in your history matches "lyra said".');
    fireEvent.click(screen.getByRole('button', { name: 'Search all personas' }));
    await waitFor(() => expect(document.querySelector('[data-search-hit="m1"]')).not.toBeNull());
    expect((document.querySelector('input[type="search"]') as HTMLInputElement).value).toBe(
      'lyra said',
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

describe('HistoryPage — q and return parameters', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
    sessionStorage.clear();
    rotateHistoryGen();
    searches.length = 0;
  });

  it('?q= pre-fills the search field, filters, and leaves the address at once', async () => {
    await seed();
    renderHistory('/app/history?q=book');
    await screen.findByText('about books');
    const input = document.querySelector('input[type="search"]') as HTMLInputElement;
    expect(input.value).toBe('book');
    expect(screen.queryByText('private chat')).toBeNull();
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/app/history'));
    expect(screen.getByTestId('nav-state').textContent).toContain('"q":"book"');
  });

  it('?return= drives the back control', async () => {
    const { sfwId } = await seed();
    renderHistory(
      `/app/history?personaId=${sfwId}&return=${encodeURIComponent(`/app/persona/${sfwId}`)}`,
    );
    await screen.findByText('about books');
    fireEvent.click(screen.getByRole('button', { name: /^back$/i }));
    await waitFor(() => expect(screen.getByTestId('hub')).toBeInTheDocument());
  });

  it('an off-origin ?return= falls back to /app', async () => {
    await seed();
    renderHistory(`/app/history?return=${encodeURIComponent('//evil.example')}`);
    await screen.findByText('about books');
    fireEvent.click(screen.getByRole('button', { name: /^back$/i }));
    await waitFor(() => expect(screen.getByTestId('entrance')).toBeInTheDocument());
  });

  it('clearing the persona filter keeps return in the URL and the query in state', async () => {
    const { sfwId } = await seed();
    const ret = encodeURIComponent('/app/persona/x');
    renderHistory(`/app/history?personaId=${sfwId}&q=book&return=${ret}`);
    await screen.findByText('about books');
    fireEvent.click(screen.getByRole('button', { name: 'Filter by persona' }));
    fireEvent.click(screen.getByRole('button', { name: 'All personas' }));
    await waitFor(() => {
      const loc = screen.getByTestId('location').textContent ?? '';
      expect(loc).not.toContain('personaId=');
      expect(loc).not.toContain('q=');
      expect(loc).toContain(`return=${ret}`);
    });
    expect((document.querySelector('input[type="search"]') as HTMLInputElement).value).toBe('book');
  });
});

describe('HistoryPage — search inside messages', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
    sessionStorage.clear();
    rotateHistoryGen();
    searches.length = 0;
  });

  it('placeholders name what each tab searches', async () => {
    await seed();
    renderHistory();
    await screen.findByText('about books');
    const input = () => document.querySelector('input[type="search"]') as HTMLInputElement;
    expect(input().placeholder).toBe('Search titles and messages…');
    fireEvent.click(screen.getByRole('tab', { name: 'Bookmarks' }));
    await waitFor(() => expect(input().placeholder).toBe('Search bookmarks…'));
  });

  it('a one-letter query filters titles, keeps the count and hints', async () => {
    await seed();
    renderHistory();
    await screen.findByText('about books');
    typeQuery('b');
    await screen.findByText('Type one more letter to search inside messages.');
    expect(screen.getByText('1 of 2')).toBeTruthy();
    expect(document.querySelector('[data-section]')).toBeNull();
  });

  it('shows message hits under the titles, hides the count line, and jumps with ?focus=', async () => {
    const { chatA } = await seed();
    await addMessages(chatA, [
      { id: 'm1', text: 'Use a teaspoon of **smoked** paprika.' },
      { id: 'm2', text: 'nothing here', role: 'user' },
    ]);
    renderHistory();
    await screen.findByText('about books');
    typeQuery('Paprika SMOKED');
    const hit = await waitFor(() => {
      const el = document.querySelector('[data-search-hit="m1"]');
      if (!el) throw new Error('no hit yet');
      return el;
    });
    await screen.findByText('In messages · 1');
    expect(screen.queryByText(/of 2|chats$/)).toBeNull();
    expect(hit.textContent).not.toContain('**');
    expect([...hit.querySelectorAll('mark')].map((m) => m.textContent)).toEqual([
      'smoked',
      'paprika',
    ]);
    // No title matches ⇒ no titles section.
    expect(document.querySelector('[data-section="titles"]')).toBeNull();

    fireEvent.click(hit.querySelector('button') as HTMLButtonElement);
    await screen.findByTestId('chat');
    expect(screen.getByTestId('location').textContent).toBe(`/app/chat/${chatA}?focus=m1`);
    // The way back is remembered for this chat, with the query in its state only.
    const target = historyReturnTarget(chatA);
    expect(target?.to).toBe('/app/history');
    expect(target?.state.q).toBe('Paprika SMOKED');
    expect(searches.some((s) => /paprika/i.test(s))).toBe(false);
  });

  it('never shows an adult chat in SFW mode — no hit, header or count', async () => {
    const { chatA, chatB } = await seed({ adultMode: 'sfw' });
    await addMessages(chatA, [{ id: 'mA', text: 'paprika in a stew' }]);
    await addMessages(chatB, [{ id: 'mB', text: 'paprika somewhere private' }]);
    renderHistory();
    await screen.findByText('about books');
    typeQuery('paprika');
    await waitFor(() => expect(document.querySelector('[data-search-hit="mA"]')).not.toBeNull());
    await screen.findByText('In messages · 1');
    await waitFor(() => expect(document.querySelector('.cs-search-progress')).toBeNull());
    expect(document.querySelector('[data-search-hit="mB"]')).toBeNull();
    expect(screen.queryByText('private chat')).toBeNull();
    expect(document.body.textContent).not.toContain('private');
  });

  it('says no messages contain the query when only titles match', async () => {
    await seed();
    renderHistory();
    await screen.findByText('about books');
    typeQuery('books');
    await screen.findByText('No messages contain "books".');
    expect(screen.getByText('Chat titles · 1')).toBeTruthy();
  });

  it('collapses more than five title matches behind Show all', async () => {
    const { sfwId } = await seed();
    const db = await openClientDataDb();
    const ms = (await db.mindspaces.toArray())[0];
    if (!ms) throw new Error('no mindspace');
    await db.chats.bulkAdd(
      Array.from({ length: 6 }, (_, i) => ({
        id: uuidv7(),
        personaId: sfwId,
        title: `stew number ${i}`,
        resolvedMindspaceId: ms.id,
        createdAt: 0,
        updatedAt: 0,
        lastMessageAt: 300 + i,
        bookmarkedMessageCount: 0,
        draftInput: '',
        libraryIds: [],
      })),
    );
    renderHistory();
    await screen.findByText('stew number 5');
    typeQuery('stew');
    await screen.findByText('Chat titles · 6');
    expect(document.querySelectorAll('[data-history-row]').length).toBe(5);
    fireEvent.click(screen.getByRole('button', { name: 'Show all 6 chats' }));
    await waitFor(() => expect(document.querySelectorAll('[data-history-row]').length).toBe(6));
  });

  it('keeps the tab in the address and honours ?tab=bookmarks', async () => {
    await seed();
    renderHistory('/app/history?tab=bookmarks');
    await screen.findByText(/no bookmarks yet/i);
    expect(screen.getByRole('tab', { name: 'Bookmarks' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    fireEvent.click(screen.getByRole('tab', { name: 'Chats' }));
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/app/history'));
    fireEvent.click(screen.getByRole('tab', { name: 'Bookmarks' }));
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe('/app/history?tab=bookmarks'),
    );
  });

  it('the typed query lives in navigation state, never in the address', async () => {
    await seed();
    renderHistory();
    await screen.findByText('about books');
    typeQuery('secret words');
    await waitFor(() =>
      expect(screen.getByTestId('nav-state').textContent).toContain('"q":"secret words"'),
    );
    expect(searches.some((s) => s.includes('secret'))).toBe(false);
  });

  it('bookmarks match on message text too, with a snippet for a text-only match', async () => {
    const { chatA } = await seed();
    await addMessages(chatA, [
      {
        id: 'b1',
        text: 'First line here.\nThen in paragraph two the smoked paprika appears.',
        bookmarked: true,
      },
      { id: 'b2', text: 'Paprika in the label line', bookmarked: true },
    ]);
    const db = await openClientDataDb();
    await db.messages.update('b1', { bookmarkLabel: 'Renamed thing' });
    renderHistory('/app/history?tab=bookmarks');
    await screen.findByText('Renamed thing');
    typeQuery('paprika');
    await waitFor(() => expect(document.querySelector('mark.cs-search-mark')).not.toBeNull());
    expect(screen.getByText('Renamed thing')).toBeTruthy();
    // The label match shows no snippet; the text-only match does.
    const marks = [...document.querySelectorAll('mark.cs-search-mark')];
    expect(marks.length).toBe(1);
    expect(marks[0]?.textContent?.toLowerCase()).toBe('paprika');
    typeQuery('nowhere');
    await screen.findByText('No bookmarks match your filter.');
  });

  it('restores the held query and scroll offset once the list has rendered', async () => {
    const { chatA } = await seed();
    await addMessages(chatA, [{ id: 'm1', text: 'smoked paprika' }]);
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
    renderHistory({
      pathname: '/app/history',
      state: { q: 'paprika', scrollY: 420, gen: currentHistoryGen() },
    });
    await waitFor(() => expect(document.querySelector('[data-search-hit="m1"]')).not.toBeNull());
    expect((document.querySelector('input[type="search"]') as HTMLInputElement).value).toBe(
      'paprika',
    );
    expect(scrollTo).toHaveBeenCalledWith(0, 420);
    expect(scrollTo).toHaveBeenCalledTimes(1);
    scrollTo.mockRestore();
  });
});
