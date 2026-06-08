// SPDX-License-Identifier: AGPL-3.0-only
import type { Offering } from '@chatsundere/llm-unified';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { _resetClientDataDbForTests, openClientDataDb } from '../../../src/boot/client-data-db.js';
import type { PersonaRow } from '../../../src/boot/client-data-db.js';
import { InteractionMode } from '../../../src/components/chat/InteractionMode.js';
import { useCurrentChatStore } from '../../../src/state/current-chat.store.js';

beforeEach(async () => {
  useCurrentChatStore.getState().reset();
  useCurrentChatStore.getState().setInteractionMode(true);
  await _resetClientDataDbForTests();
  await openClientDataDb();
});
afterEach(async () => {
  await _resetClientDataDbForTests();
});

// The gauge text is contextUtilisation(usedTokens, window). With usedTokens
// = window/2 the gauge must read 50% — proving `window` is the resolved value.
it('gauge uses the resolved context window (clamped), not raw recommended', () => {
  const offering = {
    context: { recommended: 200_000, max: 1_000_000 },
    profile: { reasoning: 'none' },
  } as unknown as Offering;
  // override below the 64k floor -> resolves to 65_536
  const persona = {
    id: 'p',
    name: 'A',
    colour: '#fff',
    font: 'serif',
    contextWindow: 1_000,
    libraryIds: [],
    instructions: 'x',
    adultPersona: false,
    chatsundereTonality: true,
    tagline: '',
    canonicalId: null,
    providerId: '',
    modelId: '',
    mindspaceId: null,
    aboutMeOverride: null,
    textureOverride: null,
    temperature: 0.85,
    createdAt: 1,
    updatedAt: 1,
  } as unknown as PersonaRow;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <InteractionMode
          persona={persona}
          chatId="c1"
          chat={null}
          offering={offering}
          usedTokens={32_768}
          draftValue=""
          onDraftChange={() => {}}
          onSend={() => {}}
          isStreamLive={false}
          isSending={false}
          onExit={() => {}}
          onRenameChat={() => {}}
          onOpenPersonaEditor={() => {}}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(screen.getByText('50%')).toBeInTheDocument();
});
