// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type MessageRow,
  type PersonaRow,
  _resetClientDataDbForTests,
  openClientDataDb,
} from '../../../src/boot/client-data-db.js';
import { MINDSPACE_FALLBACK } from '../../../src/components/chat/ChatStream.js';
import { MessageBlock } from '../../../src/components/chat/MessageBlock.js';

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

function message(over: Partial<MessageRow> = {}): MessageRow {
  return {
    id: 'm1',
    chatId: 'c1',
    role: 'persona',
    contentBlocks: [{ type: 'text', text: 'Oh, you again — good.' }],
    createdAt: 1,
    bookmarked: false,
    streamingState: 'complete',
    ...over,
  };
}

function renderBlock(msg: MessageRow) {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <MessageBlock
        message={msg}
        pills={new Map()}
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
}

beforeEach(async () => {
  await openClientDataDb();
});
afterEach(async () => {
  await _resetClientDataDbForTests();
});

describe('MessageBlock — Primer marker', () => {
  it('renders a Primer marker on a seed message', () => {
    renderBlock(message({ kind: 'seed', seedRole: 'greeting' }));
    expect(screen.getByText('Primer')).toBeTruthy();
  });

  it('does not render a Primer marker on a normal message', () => {
    renderBlock(message());
    expect(screen.queryByText('Primer')).toBeNull();
  });
});
