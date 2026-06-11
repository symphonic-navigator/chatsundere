// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import Dexie from 'dexie';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { useBranchChat } from '../../src/data/chats.js';

function wrapper({ children }: { children: ReactNode }): JSX.Element {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

// The v19 store map — exactly what existed before v20 was added.
const V19_STORES = {
  settings: 'id',
  providers: 'id, templateId, enabled',
  mindspaces: 'id, builtIn, displayName',
  personas: 'id, providerId',
  chats: 'id, personaId, lastMessageAt, [personaId+lastMessageAt]',
  messages: 'id, chatId, [chatId+createdAt]',
  pills: 'id, messageId',
  personaAvatars: 'personaId',
  attachments: 'id, chatId, messageId, [chatId+messageId]',
  artefacts: 'id, chatId, personaId, favourite, [chatId+createdAt]',
  libraries: 'id, name, nsfw',
  documents: 'id, libraryId, embeddingStatus, [libraryId+createdAt]',
  mcpServers: 'id, createdAt',
} as const;

/** Plant a v19 database with a persona row that lacks the four new roleplay fields. */
async function plantV19Database(): Promise<void> {
  const v19 = new Dexie('chatsundere_client_data');
  for (let v = 1; v <= 19; v++) v19.version(v).stores(V19_STORES);
  await v19.open();
  await v19.table('personas').add({
    id: 'p-legacy',
    name: 'Legacy Persona',
    tagline: '',
    colour: '#fff',
    font: 'serif',
    instructions: 'Be helpful.',
    canonicalId: null,
    providerId: 'pr1',
    modelId: 'm1',
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
    createdAt: 1,
    updatedAt: 1,
    // roleplay, narration, greetingEnabled, greetingInstructions deliberately absent
  });
  v19.close();
}

beforeEach(async () => {
  await _resetClientDataDbForTests();
});

afterEach(async () => {
  await _resetClientDataDbForTests();
});

describe('Dexie v20 — roleplay & greeting schema', () => {
  it('backfills roleplay defaults onto existing personas', async () => {
    // Plant a v19 database with a persona lacking the new fields.
    await plantV19Database();
    // Reset the handle (keepData = true) so openClientDataDb runs the v20 upgrade.
    await _resetClientDataDbForTests({ keepData: true });
    await openClientDataDb();

    const db = getClientDataDb();
    expect(db.verno).toBe(21);

    const row = await db.personas.get('p-legacy');
    expect(row?.roleplay).toBe(false);
    expect(row?.narration).toBe('first');
    expect(row?.greetingEnabled).toBe(false);
    expect(row?.greetingInstructions).toBe('');
  });

  it('branch-copied messages preserve kind', async () => {
    await openClientDataDb();
    const db = getClientDataDb();

    await db.chats.add({
      id: 'c-src',
      personaId: 'p1',
      title: 'Source',
      resolvedMindspaceId: 'm1',
      createdAt: 100,
      lastMessageAt: 300,
      bookmarkedMessageCount: 0,
      draftInput: '',
      libraryIds: [],
    });

    // An opener message — the kind that must survive the branch copy.
    await db.messages.add({
      id: 'opener1',
      chatId: 'c-src',
      role: 'persona',
      contentBlocks: [{ type: 'text', text: 'Hello there!' }],
      createdAt: 100,
      bookmarked: false,
      streamingState: 'complete',
      kind: 'opener',
    });

    // A regular user message after the opener.
    await db.messages.add({
      id: 'user1',
      chatId: 'c-src',
      role: 'user',
      contentBlocks: [{ type: 'text', text: 'hi' }],
      createdAt: 200,
      bookmarked: false,
      streamingState: 'complete',
    });

    const { result } = renderHook(() => useBranchChat(), { wrapper });
    await waitFor(() => expect(result.current.mutateAsync).toBeDefined());

    const newChatId = await result.current.mutateAsync({
      sourceChatId: 'c-src',
      branchPointMessageId: 'user1',
      title: 'Branch',
    });

    const branchMsgs = await db.messages.where('chatId').equals(newChatId).sortBy('createdAt');
    expect(branchMsgs).toHaveLength(2);

    const copiedOpener = branchMsgs.find((m) => m.role === 'persona');
    expect(copiedOpener?.kind).toBe('opener');

    const copiedUser = branchMsgs.find((m) => m.role === 'user');
    expect(copiedUser?.kind).toBeUndefined();
  });
});
