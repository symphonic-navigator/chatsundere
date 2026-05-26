import { fireEvent, render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MessageRow, PersonaRow } from '../../src/boot/client-data-db';
import { ChatStream, MINDSPACE_FALLBACK } from '../../src/components/chat/ChatStream';
import { useCurrentChatStore } from '../../src/state/current-chat.store';
import type { StreamHandle } from '../../src/state/stream-manager.store';

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

function userMsg(id: string, text: string, ts: number): MessageRow {
  return {
    id,
    chatId: 'c1',
    role: 'user',
    contentBlocks: [{ type: 'text', text }],
    createdAt: ts,
    bookmarked: false,
    streamingState: 'complete',
  };
}
function personaMsg(
  id: string,
  text: string,
  ts: number,
  state: 'complete' | 'incomplete' = 'complete',
): MessageRow {
  return {
    id,
    chatId: 'c1',
    role: 'persona',
    contentBlocks: [{ type: 'text', text }],
    createdAt: ts,
    bookmarked: false,
    streamingState: state,
  };
}

describe('ChatStream', () => {
  it('renders messages in order with DateSeparator between days', () => {
    const day1 = new Date('2026-05-23T10:00:00').getTime();
    const day2 = new Date('2026-05-24T10:00:00').getTime();
    const { container } = render(
      <ChatStream
        chatId="c1"
        messages={[userMsg('m1', 'first', day1), userMsg('m2', 'second', day2)]}
        pills={[]}
        persona={aurum}
        displayName="Chris"
        streamHandle={null}
      />,
    );
    const seps = container.querySelectorAll('[role="separator"]');
    expect(seps.length).toBeGreaterThanOrEqual(1); // at least the boundary between days
    const blocks = container.querySelectorAll('.msg');
    expect(blocks.length).toBe(2);
  });

  it('renders StreamingCursor inside the draft message', () => {
    const draftMsg = personaMsg('d1', '', Date.now(), 'incomplete');
    const handle: StreamHandle = {
      chatId: 'c1',
      personaId: 'p1',
      draftMessageId: 'd1',
      controller: new AbortController(),
      status: 'streaming',
      contentBuffer: [],
      pillBuffer: [],
      startedAt: Date.now(),
    };
    const { container } = render(
      <ChatStream
        chatId="c1"
        messages={[draftMsg]}
        pills={[]}
        persona={aurum}
        displayName="Chris"
        streamHandle={handle}
      />,
    );
    expect(container.querySelector('[data-msg-id="d1"] .streaming-cursor')).not.toBeNull();
  });

  it('scrolling up > 30px disables auto-follow', () => {
    useCurrentChatStore.getState().reset();
    const { container } = render(
      <ChatStream
        chatId="c1"
        messages={[userMsg('m1', 'hi', 1)]}
        pills={[]}
        persona={aurum}
        displayName="Chris"
        streamHandle={null}
      />,
    );
    const stream = container.querySelector('.chat-stream') as HTMLElement;
    // simulate: total scroll height much larger than viewport, user scrolled away from bottom
    Object.defineProperty(stream, 'scrollHeight', { value: 1000, configurable: true });
    Object.defineProperty(stream, 'clientHeight', { value: 400, configurable: true });
    Object.defineProperty(stream, 'scrollTop', { value: 500, configurable: true, writable: true });
    fireEvent.scroll(stream);
    expect(useCurrentChatStore.getState().autoFollowEnabled).toBe(false);
  });

  it('copyMessageText excludes reasoning blocks from the clipboard', () => {
    useCurrentChatStore.getState().reset();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    const message: MessageRow = {
      id: 'm-clip',
      chatId: 'c1',
      role: 'persona',
      contentBlocks: [
        { type: 'reasoning', text: 'inner thought' },
        { type: 'text', text: 'visible answer' },
      ],
      streamingState: 'complete',
      bookmarked: false,
      createdAt: Date.now(),
    };

    const { container } = render(
      <ChatStream
        chatId="c1"
        messages={[message]}
        pills={[]}
        persona={aurum}
        displayName="Chris"
        streamHandle={null}
      />,
    );

    // Expand the message so its MessageControls (with the Copy button) mount.
    const msg = container.querySelector('[data-msg-id="m-clip"] .msg') as HTMLElement;
    fireEvent.click(msg);

    const copyBtn = container.querySelector(
      '[data-msg-id="m-clip"] [data-ctrl="copy"]',
    ) as HTMLButtonElement;
    fireEvent.click(copyBtn);

    expect(writeText).toHaveBeenCalledWith('visible answer');
  });

  it('scrolling back into the bottom band re-enables auto-follow', () => {
    useCurrentChatStore.getState().reset();
    useCurrentChatStore.getState().setAutoFollow(false);
    const { container } = render(
      <ChatStream
        chatId="c1"
        messages={[userMsg('m1', 'hi', 1)]}
        pills={[]}
        persona={aurum}
        displayName="Chris"
        streamHandle={null}
      />,
    );
    const stream = container.querySelector('.chat-stream') as HTMLElement;
    Object.defineProperty(stream, 'scrollHeight', { value: 1000, configurable: true });
    Object.defineProperty(stream, 'clientHeight', { value: 400, configurable: true });
    Object.defineProperty(stream, 'scrollTop', { value: 590, configurable: true, writable: true });
    // distance from bottom = 1000 - (590 + 400) = 10 → within 30 band
    fireEvent.scroll(stream);
    expect(useCurrentChatStore.getState().autoFollowEnabled).toBe(true);
  });
});

describe('MINDSPACE_FALLBACK', () => {
  it('has all ResolvedMindspace fields populated (no undefined)', () => {
    expect(MINDSPACE_FALLBACK.id).toBeTruthy();
    expect(MINDSPACE_FALLBACK.displayName).toBeTruthy();
    expect(MINDSPACE_FALLBACK.texture).toBeTruthy();
    expect(MINDSPACE_FALLBACK.palette).toBeTruthy();
    expect(MINDSPACE_FALLBACK.palette.bg).toBeTruthy();
    expect(MINDSPACE_FALLBACK.palette.surfaceBase).toBeTruthy();
    expect(MINDSPACE_FALLBACK.palette.accent).toBeTruthy();
    expect(MINDSPACE_FALLBACK.palette.accentSubtle).toBeTruthy();
    expect(MINDSPACE_FALLBACK.palette.accentBorder).toBeTruthy();
    expect(MINDSPACE_FALLBACK.palette.accentBorderActive).toBeTruthy();
    expect(MINDSPACE_FALLBACK.palette.accentGlow).toBeTruthy();
    expect(MINDSPACE_FALLBACK.palette.text.primary).toBeTruthy();
    expect(MINDSPACE_FALLBACK.palette.text.secondary).toBeTruthy();
    expect(MINDSPACE_FALLBACK.palette.text.muted).toBeTruthy();
    expect(MINDSPACE_FALLBACK.palette.text.ghost).toBeTruthy();
  });
});
