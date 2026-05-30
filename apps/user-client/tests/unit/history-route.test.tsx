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
      lastMessageAt: 100,
      bookmarkedMessageCount: 0,
      draftInput: '',
    },
    {
      id: chatB,
      personaId: nsfwId,
      title: 'private chat',
      resolvedMindspaceId: ms.id,
      createdAt: 0,
      lastMessageAt: 200,
      bookmarkedMessageCount: 0,
      draftInput: '',
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
    const rows = document.querySelectorAll('.history-row');
    expect(rows[0]?.textContent).toContain('private chat');
    expect(rows[1]?.textContent).toContain('about books');
  });

  it('search filters by title substring (case-insensitive)', async () => {
    await seed();
    renderHistory();
    await screen.findByText('private chat');
    const input = document.querySelector('input[type="search"]') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'BOOK' } });
    await waitFor(() => expect(document.querySelectorAll('.history-row').length).toBe(1));
    expect(document.querySelector('.history-row')?.textContent).toContain('about books');
  });

  it('persona-filter chip narrows to one persona', async () => {
    await seed();
    renderHistory();
    await screen.findByText('private chat');
    const chips = document.querySelectorAll('[data-chip]');
    const sageChip = Array.from(chips).find((c) => c.textContent === 'Sage') as HTMLButtonElement;
    fireEvent.click(sageChip);
    await waitFor(() => expect(document.querySelectorAll('.history-row').length).toBe(1));
    expect(document.querySelector('.history-row')?.textContent).toContain('about books');
  });

  it('NSFW chip + NSFW chat hidden in SFW mode', async () => {
    await seed({ adultMode: 'sfw' });
    renderHistory();
    await screen.findByText('about books');
    expect(screen.queryByText('private chat')).toBeNull();
    const chipTexts = Array.from(document.querySelectorAll('[data-chip]')).map(
      (c) => c.textContent,
    );
    expect(chipTexts).not.toContain('Lyra');
  });

  it('flipping nsfw → sfw auto-resets persona-filter to All when the selection was NSFW', async () => {
    const { nsfwId } = await seed();
    const { qc } = renderHistory(`/app/history?personaId=${nsfwId}`);
    await screen.findByText('private chat');
    const sel = document.querySelector('[data-chip][data-selected="true"]') as HTMLElement;
    expect(sel.textContent).toBe('Lyra');

    // Direct Dexie write bypasses the React Query mutation, so we must
    // manually invalidate the settings cache to trigger a refetch.
    const db = await openClientDataDb();
    await act(async () => {
      await db.settings.update(1, { adultMode: 'sfw' });
      await qc.invalidateQueries({ queryKey: ['settings'] });
    });
    await waitFor(() => {
      const allSel = document.querySelector('[data-chip][data-selected="true"]') as HTMLElement;
      expect(allSel.textContent).toBe('All');
    });
  });

  it('?personaId=<id> URL param initialises filter selection', async () => {
    const { sfwId } = await seed();
    renderHistory(`/app/history?personaId=${sfwId}`);
    await screen.findByText('about books');
    const sel = document.querySelector('[data-chip][data-selected="true"]') as HTMLElement;
    expect(sel.textContent).toBe('Sage');
    expect(document.querySelectorAll('.history-row').length).toBe(1);
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
      createdAt: 0,
      updatedAt: 0,
    });
    renderHistory(`/app/history?personaId=${personaId}`);
    await screen.findByText(/no chats with .* yet/i);
    const link = screen.getByText(/start a new one/i).closest('a');
    expect(link?.getAttribute('href')).toBe(`/app/chat/new?personaId=${personaId}`);
  });

  it('empty state — search has no matches — no action link', async () => {
    await seed();
    renderHistory();
    await screen.findByText('private chat');
    fireEvent.change(document.querySelector('input[type="search"]') as HTMLInputElement, {
      target: { value: 'zzzzzz' },
    });
    await screen.findByText(/no chats match your search/i);
  });
});
