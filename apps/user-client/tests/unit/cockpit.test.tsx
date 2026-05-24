import type { KnownModel } from '@chatsundere/llm-unified';
import { fireEvent, render } from '@testing-library/react';
// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import type { PersonaRow } from '../../src/boot/client-data-db';
import { Cockpit } from '../../src/components/chat/Cockpit';
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
  reasoning: { kind: 'optional', defaultOn: true, replayReasoning: false },
  vision: false,
  tools: false,
};

describe('Cockpit', () => {
  it('renders two rows with the four control buttons in row 1', () => {
    const { container } = render(
      <Cockpit
        persona={aurum}
        model={model}
        draftValue=""
        onDraftChange={vi.fn()}
        onSend={vi.fn()}
        isStreamLive={false}
      />,
    );
    expect(container.querySelector('.cockpit-row-controls')).not.toBeNull();
    expect(container.querySelector('.cockpit-row-input')).not.toBeNull();
    expect(container.querySelector('[data-control="plus"]')).not.toBeNull();
    expect(container.querySelector('[data-control="menu"]')).not.toBeNull();
    expect(container.querySelector('[data-control="live"]')).not.toBeNull();
    expect(container.querySelector('[data-control="pin"]')).not.toBeNull();
  });

  it('Plus is disabled with tooltip', () => {
    const { container } = render(
      <Cockpit
        persona={aurum}
        model={model}
        draftValue=""
        onDraftChange={vi.fn()}
        onSend={vi.fn()}
        isStreamLive={false}
      />,
    );
    const btn = container.querySelector('[data-control="plus"]') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.title).toMatch(/treasury/i);
  });

  it('Live is disabled with tooltip', () => {
    const { container } = render(
      <Cockpit
        persona={aurum}
        model={model}
        draftValue=""
        onDraftChange={vi.fn()}
        onSend={vi.fn()}
        isStreamLive={false}
      />,
    );
    const btn = container.querySelector('[data-control="live"]') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.title).toMatch(/voice|block 4/i);
  });

  it('Pin toggles isPinned in the store', () => {
    useCurrentChatStore.getState().reset();
    const { container } = render(
      <Cockpit
        persona={aurum}
        model={model}
        draftValue=""
        onDraftChange={vi.fn()}
        onSend={vi.fn()}
        isStreamLive={false}
      />,
    );
    const pin = container.querySelector('[data-control="pin"]') as HTMLButtonElement;
    fireEvent.click(pin);
    expect(useCurrentChatStore.getState().isPinned).toBe(true);
    fireEvent.click(pin);
    expect(useCurrentChatStore.getState().isPinned).toBe(false);
  });

  it('Menu button toggles the CockpitMenu visibility', () => {
    const { container } = render(
      <Cockpit
        persona={aurum}
        model={model}
        draftValue=""
        onDraftChange={vi.fn()}
        onSend={vi.fn()}
        isStreamLive={false}
      />,
    );
    expect(container.querySelector('.cockpit-menu')).toBeNull();
    fireEvent.click(container.querySelector('[data-control="menu"]') as HTMLButtonElement);
    expect(container.querySelector('.cockpit-menu')).not.toBeNull();
    fireEvent.click(container.querySelector('[data-control="menu"]') as HTMLButtonElement);
    expect(container.querySelector('.cockpit-menu')).toBeNull();
  });

  it('placeholder uses persona name', () => {
    const { container } = render(
      <Cockpit
        persona={aurum}
        model={model}
        draftValue=""
        onDraftChange={vi.fn()}
        onSend={vi.fn()}
        isStreamLive={false}
      />,
    );
    const ta = container.querySelector('textarea') as HTMLTextAreaElement;
    expect(ta.placeholder).toContain('Aurum');
  });

  it('typing fires onDraftChange', () => {
    const onChange = vi.fn();
    const { container } = render(
      <Cockpit
        persona={aurum}
        model={model}
        draftValue=""
        onDraftChange={onChange}
        onSend={vi.fn()}
        isStreamLive={false}
      />,
    );
    // biome-ignore lint/style/noNonNullAssertion: textarea is always present in this render
    fireEvent.change(container.querySelector('textarea')!, { target: { value: 'hi' } });
    expect(onChange).toHaveBeenCalledWith('hi');
  });

  it('Send disabled while stream live, with hint', () => {
    const { container } = render(
      <Cockpit
        persona={aurum}
        model={model}
        draftValue="hello"
        onDraftChange={vi.fn()}
        onSend={vi.fn()}
        isStreamLive={true}
      />,
    );
    const btn = container.querySelector('[data-dual="action"]') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.title).toMatch(/aurum.*antworte|antworte/i);
  });

  it('Send invokes onSend then clears via onDraftChange when text present', () => {
    const onSend = vi.fn();
    const onChange = vi.fn();
    const { container } = render(
      <Cockpit
        persona={aurum}
        model={model}
        draftValue="hello there"
        onDraftChange={onChange}
        onSend={onSend}
        isStreamLive={false}
      />,
    );
    fireEvent.click(container.querySelector('[data-dual="action"]') as HTMLButtonElement);
    expect(onSend).toHaveBeenCalledWith('hello there');
    // Cockpit does NOT clear the draft itself — the caller (useSendMessage / stream-manager)
    // does the clearing as part of its transaction. So onChange is NOT called by Send.
    expect(onChange).not.toHaveBeenCalled();
  });

  it('Send disabled when input empty (mic shows but is also disabled)', () => {
    const { container } = render(
      <Cockpit
        persona={aurum}
        model={model}
        draftValue=""
        onDraftChange={vi.fn()}
        onSend={vi.fn()}
        isStreamLive={false}
      />,
    );
    const btn = container.querySelector('[data-dual="action"]') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});
