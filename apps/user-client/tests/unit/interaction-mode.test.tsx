import type { KnownModel } from '@chatsundere/llm-unified';
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
  providerId: '',
  modelId: '',
  mindspaceId: null,
  aboutMeOverride: null,
  textureOverride: null,
  temperature: 0.85,
  adultPersona: false,
  createdAt: 1,
  updatedAt: 1,
};
const model: KnownModel = {
  id: 'm',
  displayName: 'M',
  contextWindow: 1000,
  reasoning: { kind: 'no_reasoning', defaultOn: false, replayReasoning: false },
  vision: false,
  tools: false,
};

function mount(extra: Partial<Parameters<typeof InteractionMode>[0]> = {}) {
  return render(
    <MemoryRouter>
      <div data-testid="outside">outside</div>
      <InteractionMode
        persona={aurum}
        model={model}
        usedTokens={0}
        draftValue={extra.draftValue ?? 'hi'}
        onDraftChange={vi.fn()}
        onSend={vi.fn()}
        isStreamLive={false}
        onExit={vi.fn()}
        {...extra}
      />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useCurrentChatStore.getState().reset();
  useCurrentChatStore.getState().setInteractionMode(true);
});

describe('InteractionMode lifecycle', () => {
  it('renders Topbar + Cockpit + DimOverlay', () => {
    const { container } = mount();
    expect(container.querySelector('.interaction-topbar')).not.toBeNull();
    expect(container.querySelector('.cockpit')).not.toBeNull();
    expect(container.querySelector('.dim-overlay')).not.toBeNull();
  });

  it('DimOverlay activates only on textarea focus', () => {
    const { container } = mount();
    const overlay = container.querySelector('.dim-overlay') as HTMLElement;
    expect(overlay.getAttribute('data-active')).not.toBe('true');
    const ta = container.querySelector('textarea') as HTMLTextAreaElement;
    fireEvent.focus(ta);
    expect(overlay.getAttribute('data-active')).toBe('true');
    fireEvent.blur(ta);
    expect(overlay.getAttribute('data-active')).not.toBe('true');
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
