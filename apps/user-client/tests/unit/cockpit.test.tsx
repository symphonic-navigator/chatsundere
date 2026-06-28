// SPDX-License-Identifier: AGPL-3.0-only
import { getOffering } from '@chatsundere/llm-unified';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { PersonaRow } from '../../src/boot/client-data-db';
import { Cockpit } from '../../src/components/chat/Cockpit';
import { useCurrentChatStore } from '../../src/state/current-chat.store';
import { idleDictationStub } from '../helpers/dictation-stub';

// The Cockpit resolves the active web-search tiers via a TanStack-query-backed
// hook; this unit test exercises the cockpit controls, not the depth picker (see
// CockpitMenu.test), so stub the hook to keep it free of the query machinery.
vi.mock('../../src/lib/use-active-search-tiers.js', () => ({
  useActiveSearchTiers: () => undefined,
}));

const aurum: PersonaRow = {
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
// nano-gpt deepseek-v4-flash: steps reasoning, no vision, tools
// biome-ignore lint/style/noNonNullAssertion: test fixture — this slug is guaranteed to exist in the catalogue
const offering = getOffering('nano-gpt', 'deepseek/deepseek-v4-flash')!;

// The cockpit now reads pending attachments via a TanStack-query hook, so it
// needs a QueryClientProvider and a chatId. This helper supplies both and
// fills in the common props every test shares.
function renderCockpit(props: Partial<ComponentProps<typeof Cockpit>> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <Cockpit
          chatId="c1"
          persona={aurum}
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
          {...props}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Cockpit', () => {
  it('renders two rows with the four control buttons in row 1', () => {
    const { container } = renderCockpit();
    expect(container.querySelector('.cockpit-row-controls')).not.toBeNull();
    expect(container.querySelector('.cockpit-row-input')).not.toBeNull();
    expect(container.querySelector('[data-control="plus"]')).not.toBeNull();
    expect(container.querySelector('[data-control="menu"]')).not.toBeNull();
    expect(container.querySelector('[data-control="live"]')).not.toBeNull();
    expect(container.querySelector('[data-control="pin"]')).not.toBeNull();
  });

  it('Plus is enabled and labelled "Add attachment"', () => {
    const { container } = renderCockpit();
    const btn = container.querySelector('[data-control="plus"]') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    expect(btn.title).toMatch(/add attachment/i);
  });

  it('Live is enabled when a voice provider is configured', () => {
    const { container } = renderCockpit({ voiceUnavailable: null, onEnterLiveVoice: vi.fn() });
    const btn = container.querySelector('[data-control="live"]') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    expect(btn.title).toMatch(/live voice/i);
  });

  it('Live is disabled when no voice provider is available', () => {
    const { container } = renderCockpit({ voiceUnavailable: 'no-provider' });
    const btn = container.querySelector('[data-control="live"]') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.title).toMatch(/voice|settings/i);
  });

  it('Pin toggles isPinned in the store', () => {
    useCurrentChatStore.getState().reset();
    const { container } = renderCockpit();
    const pin = container.querySelector('[data-control="pin"]') as HTMLButtonElement;
    fireEvent.click(pin);
    expect(useCurrentChatStore.getState().isPinned).toBe(true);
    fireEvent.click(pin);
    expect(useCurrentChatStore.getState().isPinned).toBe(false);
  });

  it('Menu button toggles the CockpitMenu visibility', () => {
    const { container } = renderCockpit();
    expect(container.querySelector('.cockpit-menu')).toBeNull();
    fireEvent.click(container.querySelector('[data-control="menu"]') as HTMLButtonElement);
    expect(container.querySelector('.cockpit-menu')).not.toBeNull();
    fireEvent.click(container.querySelector('[data-control="menu"]') as HTMLButtonElement);
    expect(container.querySelector('.cockpit-menu')).toBeNull();
  });

  it('placeholder uses persona name', () => {
    const { container } = renderCockpit();
    const ta = container.querySelector('textarea') as HTMLTextAreaElement;
    expect(ta.placeholder).toContain('Aurum');
  });

  it('typing fires onDraftChange', () => {
    const onChange = vi.fn();
    const { container } = renderCockpit({ onDraftChange: onChange });
    // biome-ignore lint/style/noNonNullAssertion: textarea is always present in this render
    fireEvent.change(container.querySelector('textarea')!, { target: { value: 'hi' } });
    expect(onChange).toHaveBeenCalledWith('hi');
  });

  it('Shows stop button while stream live', () => {
    const { container } = renderCockpit({ draftValue: 'hello', isStreamLive: true });
    // When a stream is live, DualActionBtn renders the stop control, not the send button.
    const stopBtn = container.querySelector('[data-dual="stop"]') as HTMLButtonElement;
    expect(stopBtn).not.toBeNull();
    expect(stopBtn.disabled).toBe(false);
    expect(container.querySelector('[data-dual="action"]')).toBeNull();
  });

  it('Send invokes onSend then clears via onDraftChange when text present', () => {
    const onSend = vi.fn();
    const onChange = vi.fn();
    const { container } = renderCockpit({
      draftValue: 'hello there',
      onDraftChange: onChange,
      onSend,
    });
    fireEvent.click(container.querySelector('[data-dual="action"]') as HTMLButtonElement);
    expect(onSend).toHaveBeenCalledWith('hello there');
    // Cockpit does NOT clear the draft itself — the caller (useSendMessage / stream-manager)
    // does the clearing as part of its transaction. So onChange is NOT called by Send.
    expect(onChange).not.toHaveBeenCalled();
  });

  it('Send disabled when input empty (mic shows but is also disabled)', () => {
    const { container } = renderCockpit();
    // With no text and dictation unavailable the mic button renders disabled.
    const btn = container.querySelector('[data-dual="mic"]') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.disabled).toBe(true);
  });

  it('always renders the ToC + artefact buttons (no gate)', () => {
    const { container } = renderCockpit();
    expect(container.querySelector('[data-control="toc"]')).not.toBeNull();
    expect(container.querySelector('[data-control="artefacts"]')).not.toBeNull();
  });

  it('renders data-pinned="true" when pinned, "false" when not', () => {
    useCurrentChatStore.getState().reset();
    useCurrentChatStore.setState({ isPinned: true });
    let { container, unmount } = renderCockpit();
    expect(container.querySelector('.cockpit')?.getAttribute('data-pinned')).toBe('true');
    unmount();

    useCurrentChatStore.setState({ isPinned: false });
    ({ container } = renderCockpit());
    expect(container.querySelector('.cockpit')?.getAttribute('data-pinned')).toBe('false');
  });

  it('renders a stop button that calls onStop when a stream is live', () => {
    const onStop = vi.fn();
    const { getByRole } = renderCockpit({ isStreamLive: true, onStop });
    fireEvent.click(getByRole('button', { name: /stop/i }));
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  describe('dictation', () => {
    it('placeholder reflects the dictation uiState', () => {
      const capturing = renderCockpit({
        dictation: { ...idleDictationStub, uiState: 'capturing' },
      });
      let ta = capturing.container.querySelector('textarea') as HTMLTextAreaElement;
      expect(ta.placeholder).toBe('Listening…');
      capturing.unmount();

      const transcribing = renderCockpit({
        dictation: { ...idleDictationStub, uiState: 'transcribing' },
      });
      ta = transcribing.container.querySelector('textarea') as HTMLTextAreaElement;
      expect(ta.placeholder).toBe('Transcribing…');
      transcribing.unmount();

      const idle = renderCockpit();
      ta = idle.container.querySelector('textarea') as HTMLTextAreaElement;
      expect(ta.placeholder).toBe('Speak to Aurum…');
    });

    it('failed transcription shows the note with wired Retry and Discard', () => {
      const retry = vi.fn();
      const discard = vi.fn();
      const { container, getByRole } = renderCockpit({
        dictation: { ...idleDictationStub, failed: true, retry, discard },
      });
      const note = container.querySelector('.cockpit-dictation-note');
      expect(note).not.toBeNull();
      expect(note?.textContent).toContain("Couldn't transcribe.");
      fireEvent.click(getByRole('button', { name: 'Retry' }));
      expect(retry).toHaveBeenCalledTimes(1);
      fireEvent.click(getByRole('button', { name: 'Discard' }));
      expect(discard).toHaveBeenCalledTimes(1);
    });

    it('a refusal failure shows the provider-declined copy, Retry and Discard intact', () => {
      const retry = vi.fn();
      const discard = vi.fn();
      const { container, getByRole } = renderCockpit({
        dictation: { ...idleDictationStub, failed: true, failedKind: 'refusal', retry, discard },
      });
      const note = container.querySelector('.cockpit-dictation-note');
      expect(note?.textContent).toContain(
        'The voice provider declined to transcribe this recording.',
      );
      // A refusal retry stays allowed — the verdict may have been context-scored.
      fireEvent.click(getByRole('button', { name: 'Retry' }));
      expect(retry).toHaveBeenCalledTimes(1);
      fireEvent.click(getByRole('button', { name: 'Discard' }));
      expect(discard).toHaveBeenCalledTimes(1);
    });

    it('permission capture error shows the mic-permission text', () => {
      const { container } = renderCockpit({
        dictation: { ...idleDictationStub, captureError: 'permission' },
      });
      const note = container.querySelector('.cockpit-dictation-note');
      expect(note?.textContent).toMatch(/allow microphone access/i);
    });

    it('device capture error shows the retry affordance text', () => {
      const { container } = renderCockpit({
        dictation: { ...idleDictationStub, captureError: 'device' },
      });
      const note = container.querySelector('.cockpit-dictation-note');
      expect(note?.textContent).toMatch(/tap the mic to try again/i);
    });

    it('no note renders while dictation is healthy', () => {
      const { container } = renderCockpit();
      expect(container.querySelector('.cockpit-dictation-note')).toBeNull();
    });
  });
});
