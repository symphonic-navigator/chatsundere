// SPDX-License-Identifier: AGPL-3.0-only

import { useSessionStore } from '@chatsundere/ui-shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import 'fake-indexeddb/auto';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { EntranceHall } from '../../src/routes/app/entrance-hall.js';

async function seedSfwAndNsfw() {
  const db = getClientDataDb();
  const now = Date.now();
  await db.personas.add({
    id: 'p-sfw',
    name: 'Calm',
    tagline: '',
    colour: '#fff',
    font: 'serif',
    instructions: 'i',
    canonicalId: null,
    providerId: 'np',
    modelId: 'm',
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
    createdAt: now,
    updatedAt: now,
  });
  await db.personas.add({
    id: 'p-nsfw',
    name: 'Spicy',
    tagline: '',
    colour: '#fff',
    font: 'serif',
    instructions: 'i',
    canonicalId: null,
    providerId: 'np',
    modelId: 'm',
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
    createdAt: now + 1,
    updatedAt: now + 1,
  });
}

function renderHall() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <EntranceHall />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Entrance Hall filter (adult mode)', () => {
  beforeEach(async () => {
    await _resetClientDataDbForTests();
    await openClientDataDb();
    useSessionStore.setState({ session: { username: 'chris' } as never });
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
    useSessionStore.setState({ session: null });
  });

  it('NSFW mode: RoomTile meta reads "2 personas"', async () => {
    await seedSfwAndNsfw();
    renderHall();
    await waitFor(() => expect(screen.getByText(/2 personas/i)).toBeInTheDocument());
  });

  it('SFW mode: RoomTile meta reads "1 personas" (filtered count, no leak)', async () => {
    await seedSfwAndNsfw();
    await getClientDataDb().settings.update(1, { adultMode: 'sfw' });
    renderHall();
    await waitFor(() => expect(screen.getByText(/1 personas/i)).toBeInTheDocument());
    expect(screen.queryByText(/2 personas/i)).toBeNull();
  });

  it('SFW mode hides Continue-chat card when recent chat is with an adult persona', async () => {
    const db = getClientDataDb();
    const now = Date.now();
    await db.personas.add({
      id: 'p-only-nsfw',
      name: 'OnlyNsfw',
      tagline: '',
      colour: '#fff',
      font: 'serif',
      instructions: 'i',
      canonicalId: null,
      providerId: 'np',
      modelId: 'm',
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
      createdAt: now,
      updatedAt: now,
    });
    await db.chats.add({
      id: 'c-1',
      personaId: 'p-only-nsfw',
      title: 'A chat',
      resolvedMindspaceId: 'ms-1',
      createdAt: now,
      lastMessageAt: now,
      bookmarkedMessageCount: 0,
      draftInput: '',
      libraryIds: [],
    });
    await db.settings.update(1, { adultMode: 'sfw' });
    renderHall();
    await waitFor(() => expect(screen.getByText(/welcome back/i)).toBeInTheDocument());
    // Continue-chat card must be ABSENT (recent persona is adult, filtered out, no leak).
    expect(screen.queryByText(/continue chat/i)).toBeNull();
  });
});
