// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type MessageRow,
  type PersonaRow,
  _resetClientDataDbForTests,
  openClientDataDb,
} from '../../../src/boot/client-data-db.js';
import { MINDSPACE_FALLBACK } from '../../../src/components/chat/ChatStream.js';
import { MessageBlock } from '../../../src/components/chat/MessageBlock.js';

function persona(overrides: Partial<PersonaRow> = {}): PersonaRow {
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
    ...overrides,
  };
}

function msg(text: string): MessageRow {
  return {
    id: 'm1',
    chatId: 'c1',
    role: 'persona',
    contentBlocks: [{ type: 'text', text }],
    createdAt: 1,
    bookmarked: false,
    streamingState: 'incomplete',
  };
}

describe('MessageBlock progressive commit', () => {
  beforeEach(async () => {
    await openClientDataDb();
  });
  afterEach(async () => {
    await _resetClientDataDbForTests();
  });

  it('renders the committed prefix as markdown and the open tail as raw stream text', async () => {
    const qc = new QueryClient();
    const { container } = render(
      <QueryClientProvider client={qc}>
        <MessageBlock
          message={msg('First paragraph.\n\nSecond still typ')}
          pills={new Map()}
          persona={persona()}
          mindspace={MINDSPACE_FALLBACK}
          displayName="Me"
          expanded={false}
          onToggleExpand={() => {}}
          onCopy={() => {}}
          onBookmark={() => {}}
          isStreamingDraft
          currentMessageId="m1"
          currentSegmentId="0:0"
          voiceMode="paragraph"
        />
      </QueryClientProvider>,
    );
    // The committed prefix ("First paragraph.\n\n") is rendered as markdown,
    // so the voice anchor plugin should stamp data-voice-para on its <p>.
    expect(container.querySelector('[data-voice-para]')).not.toBeNull();
    // The open tail ("Second still typ") renders as raw stream-tok spans inside
    // the msg-stream-text wrapper.
    expect(container.querySelector('.msg-stream-text')?.textContent).toContain('Second still typ');
  });

  it('uses the raw streaming render when not auto-read (currentMessageId mismatch)', async () => {
    const qc = new QueryClient();
    const { container } = render(
      <QueryClientProvider client={qc}>
        <MessageBlock
          message={msg('First paragraph.\n\nSecond still typ')}
          pills={new Map()}
          persona={persona()}
          mindspace={MINDSPACE_FALLBACK}
          displayName="Me"
          expanded={false}
          onToggleExpand={() => {}}
          onCopy={() => {}}
          onBookmark={() => {}}
          isStreamingDraft
          currentMessageId={null}
          voiceMode="paragraph"
        />
      </QueryClientProvider>,
    );
    // No progressive rendering — whole text goes through the raw streaming path,
    // so no markdown voice anchors are produced.
    expect(container.querySelector('[data-voice-para]')).toBeNull();
    // The entire text (including the "first paragraph" portion) is in stream spans.
    expect(container.querySelector('.msg-stream-text')?.textContent).toContain('First paragraph.');
  });
});
