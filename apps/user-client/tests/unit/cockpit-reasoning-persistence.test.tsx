// SPDX-License-Identifier: AGPL-3.0-only
import { getOffering } from '@chatsundere/llm-unified';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PersonaRow } from '../../src/boot/client-data-db';
import { Cockpit } from '../../src/components/chat/Cockpit';
import { idleDictationStub } from '../helpers/dictation-stub';

vi.mock('../../src/lib/use-active-search-tiers.js', () => ({
  useActiveSearchTiers: () => undefined,
}));

const mutate = vi.fn();
// The Cockpit imports BOTH `useChat` and `useUpdateChat` from this module, so
// the factory must provide both — a missing export here surfaces as a broken
// component rather than a mock error.
vi.mock('../../src/data/chats.js', () => ({
  useChat: () => ({ data: { chat: { id: 'c1', useArtefactExpertModel: true } } }),
  useUpdateChat: () => ({ mutate, mutateAsync: vi.fn() }),
}));

const persona: PersonaRow = {
  id: 'p1',
  name: 'Aurum',
  tagline: '',
  colour: '#c9a84c',
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
  createdAt: 1,
  updatedAt: 1,
};

// biome-ignore lint/style/noNonNullAssertion: test fixture — this slug is guaranteed to exist in the catalogue
const offering = getOffering('nano-gpt', 'deepseek/deepseek-v4-flash')!;

function renderCockpit() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <Cockpit
          chatId="c1"
          persona={persona}
          offering={offering}
          draftValue=""
          onDraftChange={vi.fn()}
          onSend={vi.fn()}
          onStop={vi.fn()}
          isStreamLive={false}
          dictation={idleDictationStub}
          autoReadAloud={false}
          onToggleAutoRead={vi.fn()}
          voiceUnavailable={null}
          editingMessageId={null}
          canReplace={false}
          editAttachments={[]}
          onReplace={vi.fn()}
          onBranchEdit={vi.fn()}
          onCancelEdit={vi.fn()}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

// The reasoning level is scoped "for this chat", which is only true if the
// choice reaches the chat row. Without this the level lives in an unpersisted
// store and silently resets to the model default on the next mount — the defect
// Laura found on 2026-07-26.
describe('Cockpit — reasoning choice persists on the chat', () => {
  beforeEach(() => mutate.mockClear());

  it('writes the chosen step to the chat row', () => {
    renderCockpit();
    fireEvent.click(screen.getByRole('button', { name: /open chat menu/i }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /^high$/i }));
    expect(mutate).toHaveBeenCalledWith({ id: 'c1', patch: { reasoningChoice: 'high' } });
  });

  it('writes Off as the stored choice', () => {
    renderCockpit();
    fireEvent.click(screen.getByRole('button', { name: /open chat menu/i }));
    fireEvent.click(screen.getByRole('menuitemradio', { name: /^off$/i }));
    expect(mutate).toHaveBeenCalledWith({ id: 'c1', patch: { reasoningChoice: 'off' } });
  });
});
