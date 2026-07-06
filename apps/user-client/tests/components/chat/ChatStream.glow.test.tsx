// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  type MessageRow,
  type PersonaRow,
  _resetClientDataDbForTests,
  openClientDataDb,
} from '../../../src/boot/client-data-db.js';
import { ChatStream } from '../../../src/components/chat/ChatStream.js';

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

function personaMsg(id: string, createdAt: number, text: string): MessageRow {
  return {
    id,
    chatId: 'c',
    role: 'persona',
    contentBlocks: [{ type: 'text', text }],
    createdAt,
    updatedAt: createdAt,
    bookmarked: false,
    streamingState: 'complete',
  };
}

function renderWithQuery(element: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{element}</QueryClientProvider>);
}

beforeEach(async () => {
  await openClientDataDb();
});
afterEach(async () => {
  await _resetClientDataDbForTests();
});

describe('ChatStream voice glow — cross-message isolation', () => {
  // RC1: `segmentId` is only block-qualified ("blockIndex:ordinal"), never
  // message-qualified, so two different persona messages each own a segment
  // "0:0". ChatStream must therefore route `currentSegmentId` ONLY to the
  // message actually being read; otherwise every persona message with a
  // matching id glows in lock-step — a block highlighted that is not playing.
  it('glows only the playing message when two messages share segment id 0:0', async () => {
    const a = personaMsg('a', 1, 'First message, a long enough sentence here to be spoken aloud.');
    const b = personaMsg('b', 2, 'Second message, a long enough sentence here to be spoken aloud.');

    const { container } = renderWithQuery(
      <ChatStream
        chatId="c"
        messages={[a, b]}
        pills={[]}
        persona={persona()}
        displayName="Chris"
        streamHandle={null}
        voiceMode="paragraph"
        currentSegmentId="0:0"
        currentMessageId="a"
      />,
    );

    // Both messages genuinely contain the colliding id — confirms the test is
    // not trivially passing because b lacks the anchor.
    await waitFor(() => {
      expect(container.querySelector('[data-msg-id="a"] [data-voice-seg="0:0"]')).not.toBeNull();
    });
    expect(container.querySelector('[data-msg-id="b"] [data-voice-seg="0:0"]')).not.toBeNull();

    // The playing message (a) glows; the idle message (b) must NOT, despite the
    // identical segment id.
    expect(container.querySelector('[data-msg-id="a"] .voice-glow-active')).not.toBeNull();
    expect(container.querySelector('[data-msg-id="b"] .voice-glow-active')).toBeNull();
  });

  it('glows nothing while no message is being read (currentMessageId null)', async () => {
    const a = personaMsg('a', 1, 'First message, a long enough sentence here to be spoken aloud.');
    const b = personaMsg('b', 2, 'Second message, a long enough sentence here to be spoken aloud.');

    const { container } = renderWithQuery(
      <ChatStream
        chatId="c"
        messages={[a, b]}
        pills={[]}
        persona={persona()}
        displayName="Chris"
        streamHandle={null}
        voiceMode="paragraph"
        currentSegmentId={null}
        currentMessageId={null}
      />,
    );

    await waitFor(() => {
      expect(container.querySelector('[data-voice-seg="0:0"]')).not.toBeNull();
    });
    expect(container.querySelector('.voice-glow-active')).toBeNull();
  });
});
