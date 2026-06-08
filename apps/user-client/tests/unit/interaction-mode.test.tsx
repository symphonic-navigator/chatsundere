import { getOffering } from '@chatsundere/llm-unified';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
// SPDX-License-Identifier: AGPL-3.0-only
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PersonaRow } from '../../src/boot/client-data-db';
import { InteractionMode } from '../../src/components/chat/InteractionMode';
import { useCurrentChatStore } from '../../src/state/current-chat.store';

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
  createdAt: 1,
  updatedAt: 1,
};
// nano-gpt deepseek-v4-flash: steps reasoning, 200_000 context
// biome-ignore lint/style/noNonNullAssertion: test fixture — this slug is guaranteed to exist in the catalogue
const offering = getOffering('nano-gpt', 'deepseek/deepseek-v4-flash')!;

function mount(extra: Partial<Parameters<typeof InteractionMode>[0]> = {}) {
  // The topbar renders <PersonaAvatar>, which reads its row via TanStack Query.
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <div data-testid="outside">outside</div>
        <InteractionMode
          persona={aurum}
          chatId="c1"
          chat={null}
          offering={offering}
          usedTokens={0}
          draftValue={extra.draftValue ?? 'hi'}
          onDraftChange={vi.fn()}
          onSend={vi.fn()}
          onStop={vi.fn()}
          isStreamLive={false}
          onExit={vi.fn()}
          onRenameChat={vi.fn()}
          {...extra}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  useCurrentChatStore.getState().reset();
  useCurrentChatStore.getState().setInteractionMode(true);
});

describe('InteractionMode lifecycle', () => {
  it('renders Topbar + Cockpit (DimOverlay now lives at chat-page level)', () => {
    const { container } = mount();
    expect(container.querySelector('.interaction-topbar')).not.toBeNull();
    expect(container.querySelector('.cockpit')).not.toBeNull();
    // The overlay was lifted out of InteractionMode so its un-dim fade
    // survives this component unmounting on close — it renders in chat-page.
    expect(container.querySelector('.dim-overlay')).toBeNull();
  });

  it('drives inputFocused from textarea focus (cockpit autofocuses on open)', () => {
    const { container } = mount();
    const ta = container.querySelector('textarea') as HTMLTextAreaElement;
    // The cockpit autofocuses its input on open so the user can type straight
    // away, so the focus flag (which drives the overlay) starts true.
    expect(useCurrentChatStore.getState().inputFocused).toBe(true);
    fireEvent.blur(ta);
    expect(useCurrentChatStore.getState().inputFocused).toBe(false);
    fireEvent.focus(ta);
    expect(useCurrentChatStore.getState().inputFocused).toBe(true);
  });

  it('Send with non-empty input closes after a 100ms delay', async () => {
    vi.useFakeTimers();
    const onSend = vi.fn();
    const { container } = mount({ onSend, draftValue: 'hello' });
    const btn = container.querySelector('[data-dual="action"]') as HTMLButtonElement;
    fireEvent.click(btn);
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(useCurrentChatStore.getState().isInteractionMode).toBe(true); // not yet
    await act(async () => {
      vi.advanceTimersByTime(120);
    });
    expect(useCurrentChatStore.getState().isInteractionMode).toBe(false);
    vi.useRealTimers();
  });

  it('outside-tap closes (when not pinned)', () => {
    const { getByTestId } = mount();
    fireEvent.pointerDown(getByTestId('outside'));
    expect(useCurrentChatStore.getState().isInteractionMode).toBe(false);
  });

  it('tap on the brand logo does not close (its click navigates instead)', () => {
    // The logo lives in the header, outside the interaction container. An
    // unpinned outside-tap would normally close + swallow the click; the logo
    // is exempt so its <Link> can navigate back to the Entrance Hall.
    const logo = document.createElement('a');
    logo.className = 'brand-logo';
    document.body.appendChild(logo);
    mount();
    fireEvent.pointerDown(logo);
    expect(useCurrentChatStore.getState().isInteractionMode).toBe(true);
    logo.remove();
  });

  it('tap inside the lightbox overlay does not close (it is portalled to body, outside the container)', () => {
    // The lightbox renders via a portal to <body>, so a click inside it is
    // technically outside the interaction container. It must NOT be treated as
    // an outside-tap — that would collapse the cockpit and unmount the lightbox
    // (the lightbox is a Cockpit child), making in-lightbox clicks close it.
    const root = document.createElement('div');
    root.className = 'lightbox-root';
    const btn = document.createElement('button');
    root.appendChild(btn);
    document.body.appendChild(root);
    mount();
    fireEvent.pointerDown(btn);
    expect(useCurrentChatStore.getState().isInteractionMode).toBe(true);
    root.remove();
  });

  it('tap inside a sheet overlay (artefact sidebar / ToC / branch / attach picker) does not close the cockpit', () => {
    // Sheet overlays render at chat-page level, outside the interaction
    // container. A tap inside one must NOT count as an outside-tap — otherwise
    // the first tap is swallowed (and the cockpit collapses) instead of reaching
    // the control, so opening an artefact from the sidebar — or selecting one in
    // the attach picker — over an unpinned cockpit would take two taps.
    for (const cls of [
      'artefact-sheet-root',
      'toc-sheet-root',
      'branch-sheet-root',
      'artefact-picker-root',
    ]) {
      useCurrentChatStore.getState().reset();
      useCurrentChatStore.getState().setInteractionMode(true);
      const root = document.createElement('div');
      root.className = cls;
      const btn = document.createElement('button');
      root.appendChild(btn);
      document.body.appendChild(root);
      mount();
      fireEvent.pointerDown(btn);
      expect(useCurrentChatStore.getState().isInteractionMode).toBe(true);
      root.remove();
    }
  });

  it('outside-tap does NOT close when pinned', () => {
    useCurrentChatStore.getState().togglePin();
    const { getByTestId } = mount();
    fireEvent.pointerDown(getByTestId('outside'));
    expect(useCurrentChatStore.getState().isInteractionMode).toBe(true);
  });

  it('Send does NOT close when pinned', async () => {
    vi.useFakeTimers();
    useCurrentChatStore.getState().togglePin();
    const { container } = mount({ draftValue: 'hi' });
    fireEvent.click(container.querySelector('[data-dual="action"]') as HTMLButtonElement);
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    expect(useCurrentChatStore.getState().isInteractionMode).toBe(true);
    vi.useRealTimers();
  });

  it('Send while pinned keeps input focus → full interaction', () => {
    useCurrentChatStore.getState().togglePin();
    const { container } = mount({ draftValue: 'hi' });
    const ta = container.querySelector('textarea') as HTMLTextAreaElement;
    ta.focus();
    fireEvent.focus(ta);
    expect(useCurrentChatStore.getState().inputFocused).toBe(true);
    fireEvent.click(container.querySelector('[data-dual="action"]') as HTMLButtonElement);
    // Pinned = full interaction: the input keeps focus so the user can keep
    // typing. The streamed reply is legible not because focus was shed, but
    // because the DimOverlay is suppressed while pinned (chat-page level).
    expect(useCurrentChatStore.getState().inputFocused).toBe(true);
    expect(document.activeElement).toBe(ta);
  });

  it('blur alone does not close', () => {
    const { container } = mount();
    const ta = container.querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.focus(ta);
    fireEvent.blur(ta);
    expect(useCurrentChatStore.getState().isInteractionMode).toBe(true);
  });

  it('blur + outside-tap closes', () => {
    const { container, getByTestId } = mount();
    const ta = container.querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.focus(ta);
    fireEvent.blur(ta);
    fireEvent.pointerDown(getByTestId('outside'));
    expect(useCurrentChatStore.getState().isInteractionMode).toBe(false);
  });
});
