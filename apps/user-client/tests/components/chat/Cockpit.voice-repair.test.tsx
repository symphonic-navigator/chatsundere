// SPDX-License-Identifier: AGPL-3.0-only
import type { Offering } from '@chatsundere/llm-unified';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AttachmentRow, PersonaRow } from '../../../src/boot/client-data-db.js';
import { Cockpit } from '../../../src/components/chat/Cockpit.js';
import { useCurrentChatStore } from '../../../src/state/current-chat.store.js';
import { idleDictationStub } from '../../helpers/dictation-stub.js';

// ── Module mocks ──────────────────────────────────────────────────────────────
// Cockpit pulls in many Dexie/TanStack Query data hooks. Mock the modules so
// the test does not require a running DB or a fully-wired provider tree.

vi.mock('../../../src/data/attachments.js', () => ({
  usePendingAttachments: () => ({ data: [] }),
  usePendingDocumentContents: () => ({ data: undefined }),
  useRemoveAttachment: () => ({ mutate: vi.fn() }),
  useRenameAttachment: () => ({ mutate: vi.fn() }),
  useUpdateAttachmentText: () => ({ mutate: vi.fn() }),
  addAttachment: vi.fn(),
}));

vi.mock('../../../src/data/knowledge.js', () => ({
  useFilteredLibraries: () => ({ data: [] }),
}));

vi.mock('../../../src/data/chats.js', () => ({
  useChat: () => ({ data: undefined }),
  useSetChatLibraries: () => ({ mutate: vi.fn() }),
  useUpdateChat: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock('../../../src/data/settings.js', () => ({
  useSettings: () => ({ data: undefined }),
  useUpdateSettings: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock('../../../src/lib/use-active-search-tiers.js', () => ({
  useActiveSearchTiers: () => [],
}));

vi.mock('../../../src/lib/use-dismiss-on-outside.js', () => ({
  useDismissOnOutside: () => {},
}));

vi.mock('../../../src/knowledge/effective-libraries.js', () => ({
  computeEffectiveLibraries: () => [],
}));

vi.mock('../../../src/attachments/file-classify.js', () => ({
  classifyFile: () => ({ ok: false, reason: 'unsupported' }),
}));

vi.mock('../../../src/attachments/image-normalise.js', () => ({
  normaliseImageForLlm: vi.fn(),
}));

// ── Fixtures ──────────────────────────────────────────────────────────────────

const persona = {
  id: 'p1',
  name: 'Fable',
  colour: '#a855f7',
  font: 'serif',
  contextWindow: 128_000,
  libraryIds: [],
  instructions: '',
  adultPersona: false,
  chatsundereTonality: true,
  tagline: '',
  canonicalId: null,
  providerId: 'chutes',
  modelId: 'fable',
  mindspaceId: null,
  aboutMeOverride: null,
  textureOverride: null,
  temperature: 0.85,
  createdAt: 1,
  updatedAt: 1,
  askExpertDefault: false,
} as unknown as PersonaRow;

const offering = {
  context: { recommended: 128_000, max: 128_000 },
  profile: { reasoning: { mode: 'none' } },
} as unknown as Offering;

function makeQc() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

const baseProps = {
  chatId: 'chat-1',
  persona,
  offering,
  draftValue: '',
  onDraftChange: vi.fn(),
  onSend: vi.fn(),
  onStop: vi.fn(),
  isStreamLive: false,
  dictation: idleDictationStub,
  // Voice-mode defaults — overridden per test case below.
  autoReadAloud: false as boolean,
  onToggleAutoRead: vi.fn() as (next: boolean) => void,
  voiceUnavailable: null as 'no-provider' | 'no-voice' | 'voices-unavailable' | null,
  onEnterLiveVoice: vi.fn() as () => void,
  onRecheckVoice: vi.fn(async () => {}) as () => Promise<void>,
  editingMessageId: null as string | null,
  canReplace: false,
  editAttachments: [] as AttachmentRow[],
  onReplace: vi.fn(),
  onBranchEdit: vi.fn(),
  onCancelEdit: vi.fn(),
};

const CHAT = '/app/chat/chat-1?x=1';
const enc = encodeURIComponent(CHAT);

function Where(): JSX.Element {
  const l = useLocation();
  return <div data-testid="where">{`${l.pathname}${l.search}`}</div>;
}

function renderCockpit(extra: Partial<typeof baseProps>) {
  const qc = makeQc();
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[CHAT]}>
        <Routes>
          <Route path="/app/chat/:chatId" element={<Cockpit {...baseProps} {...extra} />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function openNote(reason: 'no-provider' | 'no-voice') {
  const r = renderCockpit({ voiceUnavailable: reason });
  fireEvent.click(r.getByLabelText(/read replies aloud/i));
  return r;
}

afterEach(() => {
  useCurrentChatStore.getState().setArtefactExpertError(null);
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('cockpit voice note — routed by reason (spec 0.5.0 papercuts, item 2)', () => {
  it('no-provider: "Set up voice" opens Settings → Voice with the chat as return', () => {
    openNote('no-provider');
    expect(screen.getByText(/set up a voice provider/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Set up voice' }));
    expect(screen.getByTestId('where').textContent).toBe(`/app/settings/voice?return=${enc}`);
  });

  it('no-voice: "Choose a voice" opens the persona\'s Font & Voice page', () => {
    openNote('no-voice');
    expect(screen.getByText(/give this companion a voice/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Choose a voice' }));
    expect(screen.getByTestId('where').textContent).toBe(
      `/app/persona/p1/font-voice?return=${enc}`,
    );
  });

  it('voices-unavailable: "Try again" rechecks, "Voice settings" is a link', async () => {
    const onRecheckVoice = vi.fn(async () => {});
    const r = renderCockpit({ voiceUnavailable: 'voices-unavailable', onRecheckVoice });
    await act(async () => {
      fireEvent.click(r.getByLabelText(/read replies aloud/i));
    });
    expect(onRecheckVoice).toHaveBeenCalledTimes(1);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    });
    expect(onRecheckVoice).toHaveBeenCalledTimes(2);
    const link = screen.getByRole('link', { name: 'Voice settings' });
    expect(link).toHaveAttribute('href', `/app/settings/voice?return=${enc}`);
  });

  it('never routes to the Settings overview', () => {
    openNote('no-provider');
    expect(screen.queryByRole('button', { name: /settings → voice/i })).toBeNull();
  });
});

describe('cockpit Live voice tooltip — routed by reason', () => {
  it('no-provider names the voice provider', () => {
    const { getByLabelText } = renderCockpit({ voiceUnavailable: 'no-provider' });
    expect(getByLabelText('Live voice mode')).toHaveAttribute(
      'title',
      'No voice provider — set one in Settings → Voice',
    );
  });

  it('no-voice names the missing voice, not a provider', () => {
    const { getByLabelText } = renderCockpit({ voiceUnavailable: 'no-voice' });
    const title = getByLabelText('Live voice mode').getAttribute('title') ?? '';
    expect(title).toMatch(/font & voice/i);
    expect(title).not.toMatch(/provider/i);
  });
});

describe('cockpit Live voice — a tap on an unavailable button shows the note', () => {
  it('no-provider: the tap reveals the note and its repair, without starting live voice', () => {
    const onEnterLiveVoice = vi.fn();
    const r = renderCockpit({ voiceUnavailable: 'no-provider', onEnterLiveVoice });
    fireEvent.click(r.getByLabelText('Live voice mode'));
    expect(onEnterLiveVoice).not.toHaveBeenCalled();
    expect(screen.getByText(/set up a voice provider/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Set up voice' }));
    expect(screen.getByTestId('where').textContent).toBe(`/app/settings/voice?return=${enc}`);
  });

  it('no-voice: the tap reveals "Choose a voice", and a second tap hides the note', () => {
    const onEnterLiveVoice = vi.fn();
    const r = renderCockpit({ voiceUnavailable: 'no-voice', onEnterLiveVoice });
    const live = r.getByLabelText('Live voice mode');
    fireEvent.click(live);
    expect(screen.getByRole('button', { name: 'Choose a voice' })).toBeInTheDocument();
    fireEvent.click(live);
    expect(screen.queryByText(/give this companion a voice/i)).toBeNull();
    expect(onEnterLiveVoice).not.toHaveBeenCalled();
  });

  it('with a voice, the tap starts live voice as before', () => {
    const onEnterLiveVoice = vi.fn();
    const r = renderCockpit({ voiceUnavailable: null, onEnterLiveVoice });
    fireEvent.click(r.getByLabelText('Live voice mode'));
    expect(onEnterLiveVoice).toHaveBeenCalledTimes(1);
  });
});

describe('cockpit artefact-expert note', () => {
  it('Settings opens Settings → Expert with the chat as return', () => {
    useCurrentChatStore.getState().setArtefactExpertError('The artefact expert failed.');
    renderCockpit({});
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(screen.getByTestId('where').textContent).toBe(`/app/settings/expert?return=${enc}`);
  });
});
