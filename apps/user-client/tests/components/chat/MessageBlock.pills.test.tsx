// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type MessageRow,
  type PersonaRow,
  type PillRow,
  _resetClientDataDbForTests,
  openClientDataDb,
} from '../../../src/boot/client-data-db.js';
import { MINDSPACE_FALLBACK } from '../../../src/components/chat/ChatStream.js';
import { MessageBlock } from '../../../src/components/chat/MessageBlock.js';

vi.mock('../../../src/components/chat/Pill.js', () => ({
  Pill: (p: { row: PillRow; chatId?: string | null; personaId?: string | null }) => (
    <span data-testid="pill" data-chat={p.chatId ?? 'none'} data-persona={p.personaId ?? 'none'}>
      {p.row.id}
    </span>
  ),
}));

function persona(): PersonaRow {
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
  };
}

const PILL: PillRow = {
  id: 'pill-1',
  messageId: 'm1',
  kind: 'tool-call',
  positionHint: 'inline',
  status: 'completed',
  payload: { name: 'add_mcp_connector', argumentsJson: '{}', chatId: 'evil' },
  createdAt: 1,
};

const MESSAGE: MessageRow = {
  id: 'm1',
  chatId: 'c1',
  role: 'persona',
  contentBlocks: [
    { type: 'text', text: 'Here is a card.' },
    { type: 'pill', pillId: 'pill-1' },
  ],
  createdAt: 1,
  updatedAt: 1,
  bookmarked: false,
  streamingState: 'complete',
};

beforeEach(async () => {
  await openClientDataDb();
});
afterEach(async () => {
  await _resetClientDataDbForTests();
});

describe('MessageBlock — pills', () => {
  it("hands each pill the message's chat and the persona", () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MessageBlock
          message={MESSAGE}
          pills={new Map([[PILL.id, PILL]])}
          persona={persona()}
          mindspace={MINDSPACE_FALLBACK}
          displayName="Me"
          expanded={false}
          onToggleExpand={() => {}}
          onCopy={() => {}}
          onBookmark={() => {}}
        />
      </QueryClientProvider>,
    );
    const pill = screen.getByTestId('pill');
    expect(pill).toHaveAttribute('data-chat', 'c1');
    expect(pill).toHaveAttribute('data-persona', 'p1');
  });
});
