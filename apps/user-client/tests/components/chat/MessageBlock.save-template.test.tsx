// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type MessageRow,
  type PersonaRow,
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../../src/boot/client-data-db.js';
import { MINDSPACE_FALLBACK } from '../../../src/components/chat/ChatStream.js';
import { MessageBlock } from '../../../src/components/chat/MessageBlock.js';

function persona(over: Partial<PersonaRow> = {}): PersonaRow {
  return {
    id: 'p1',
    name: 'Fable',
    tagline: '',
    colour: '#8d6dff',
    font: 'serif',
    instructions: '',
    canonicalId: null,
    providerId: 'x',
    modelId: 'y',
    mindspaceId: null,
    aboutMeOverride: null,
    textureOverride: null,
    temperature: 0.7,
    adultPersona: false,
    chatsundereTonality: false,
    contextWindow: null,
    libraryIds: [],
    askExpertDefault: false,
    mcpOverrides: {},
    roleplay: false,
    narration: 'third',
    greetingEnabled: false,
    greetingInstructions: '',
    voice: 'v1',
    narratorVoice: null,
    createdAt: 1,
    updatedAt: 1,
    ...over,
  };
}

const personaMsg: MessageRow = {
  id: 'm2',
  chatId: 'c1',
  role: 'persona',
  contentBlocks: [{ type: 'text', text: 'how are you' }],
  createdAt: 2,
  updatedAt: 2,
  bookmarked: false,
  streamingState: 'complete',
};

beforeEach(async () => {
  const db = await openClientDataDb();
  await db.messages.bulkAdd([
    {
      id: 'm0',
      chatId: 'c1',
      role: 'persona',
      contentBlocks: [{ type: 'text', text: 'Hello darling' }],
      createdAt: 0,
      updatedAt: 0,
      bookmarked: false,
      kind: 'opener',
      streamingState: 'complete',
    },
    {
      id: 'm1',
      chatId: 'c1',
      role: 'user',
      contentBlocks: [{ type: 'text', text: 'hi' }],
      createdAt: 1,
      updatedAt: 1,
      bookmarked: false,
      streamingState: 'complete',
    },
    personaMsg,
  ]);
});
afterEach(async () => {
  await _resetClientDataDbForTests();
});

describe('MessageBlock — Save as template', () => {
  it('captures the conversation up to this message into a new template', async () => {
    const qc = new QueryClient();
    render(
      <QueryClientProvider client={qc}>
        <MessageBlock
          message={personaMsg}
          pills={new Map()}
          persona={persona()}
          mindspace={MINDSPACE_FALLBACK}
          displayName="Me"
          expanded={true}
          onToggleExpand={() => {}}
          onCopy={() => {}}
          onBookmark={() => {}}
        />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /more actions/i }));
    fireEvent.click(screen.getByText(/save as template/i));

    await waitFor(async () => {
      const rows = await getClientDataDb().seedTemplates.toArray();
      expect(rows).toHaveLength(1);
    });
    const [row] = await getClientDataDb().seedTemplates.toArray();
    // Opener → greeting; the real turns → an alternating body.
    expect(row?.greeting).toBe('Hello darling');
    expect(row?.body).toEqual([
      { role: 'user', text: 'hi' },
      { role: 'persona', text: 'how are you' },
    ]);
    expect(row?.name.startsWith('Fable —')).toBe(true);
    expect(row?.nsfw).toBe(false);
  });
});
