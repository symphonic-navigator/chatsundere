import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MessageRow, PersonaRow, PillRow } from '../../src/boot/client-data-db';
import { MessageBlock } from '../../src/components/chat/MessageBlock';

function userMsg(over: Partial<MessageRow> = {}): MessageRow {
  return {
    id: 'm-u',
    chatId: 'c1',
    role: 'user',
    contentBlocks: [{ type: 'text', text: 'hello' }],
    createdAt: 1,
    bookmarked: false,
    streamingState: 'complete',
    ...over,
  };
}

function personaMsg(over: Partial<MessageRow> = {}): MessageRow {
  return {
    id: 'm-p',
    chatId: 'c1',
    role: 'persona',
    contentBlocks: [{ type: 'text', text: 'reply' }],
    createdAt: 2,
    bookmarked: false,
    streamingState: 'complete',
    ...over,
  };
}

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

describe('MessageBlock', () => {
  it('user variant renders display name with feather prefix and tinted persona colour', () => {
    const { container } = render(
      <MessageBlock
        message={userMsg()}
        pills={new Map()}
        persona={aurum}
        displayName="Chris"
        expanded={false}
        onToggleExpand={vi.fn()}
        onCopy={vi.fn()}
        onBookmark={vi.fn()}
      />,
    );
    expect(container.querySelector('.msg.from-user')).not.toBeNull();
    const prefix = container.querySelector('.msg.from-user .msg-name-prefix');
    expect(prefix?.textContent).toBe('🪶');
    const nameText = container.querySelector('.msg.from-user .msg-name-text');
    expect(nameText?.textContent).toBe('Chris');
    expect(container.textContent).toContain('hello');
    // Less-saturated tint built off the persona accent. jsdom keeps color-mix
    // as a raw string, so we assert by substring.
    const nameEl = container.querySelector('.msg.from-user .msg-name') as HTMLElement;
    expect(nameEl.style.color).toContain('color-mix');
    expect(nameEl.style.color).toContain('#c9a84c');
    // The user name now also wears the persona's font — the chat surface
    // speaks in one voice end-to-end.
    expect(nameEl.style.fontFamily).toBe('var(--font-display)');
  });

  it('persona variant renders persona name with sparkle prefix in persona colour and font', () => {
    const { container } = render(
      <MessageBlock
        message={personaMsg()}
        pills={new Map()}
        persona={aurum}
        displayName="Chris"
        expanded={false}
        onToggleExpand={vi.fn()}
        onCopy={vi.fn()}
        onBookmark={vi.fn()}
      />,
    );
    const block = container.querySelector('.msg.from-persona');
    expect(block).not.toBeNull();
    const prefix = container.querySelector('.msg.from-persona .msg-name-prefix');
    expect(prefix?.textContent).toBe('✨');
    const nameText = container.querySelector('.msg.from-persona .msg-name-text');
    expect(nameText?.textContent).toBe('Aurum');
    const nameEl = container.querySelector('.msg.from-persona .msg-name') as HTMLElement;
    expect(nameEl.style.color.replace(/\s/g, '')).toBe('rgb(201,168,76)');
  });

  it('message text uses the persona font on both user and persona messages', () => {
    const { container, rerender } = render(
      <MessageBlock
        message={personaMsg()}
        pills={new Map()}
        persona={aurum}
        displayName="Chris"
        expanded={false}
        onToggleExpand={vi.fn()}
        onCopy={vi.fn()}
        onBookmark={vi.fn()}
      />,
    );
    const personaText = container.querySelector('.msg.from-persona .msg-text') as HTMLElement;
    // Aurum uses 'serif' → maps to --font-display.
    expect(personaText.style.fontFamily).toBe('var(--font-display)');

    rerender(
      <MessageBlock
        message={userMsg()}
        pills={new Map()}
        persona={aurum}
        displayName="Chris"
        expanded={false}
        onToggleExpand={vi.fn()}
        onCopy={vi.fn()}
        onBookmark={vi.fn()}
      />,
    );
    const userText = container.querySelector('.msg.from-user .msg-text') as HTMLElement;
    expect(userText.style.fontFamily).toBe('var(--font-display)');
  });

  it('applies token-fade class to text spans only while message is the streaming draft', () => {
    const msg = personaMsg({
      contentBlocks: [
        { type: 'text', text: 'Hi' },
        { type: 'text', text: ' world' },
      ],
    });
    const { container, rerender } = render(
      <MessageBlock
        message={msg}
        pills={new Map()}
        persona={aurum}
        displayName="Chris"
        expanded={false}
        onToggleExpand={vi.fn()}
        onCopy={vi.fn()}
        onBookmark={vi.fn()}
        isStreamingDraft={true}
      />,
    );
    const spans = container.querySelectorAll('.msg-text > span');
    expect(spans.length).toBe(2);
    expect(spans[0]?.className).toBe('token-fade');
    expect(spans[1]?.className).toBe('token-fade');

    rerender(
      <MessageBlock
        message={msg}
        pills={new Map()}
        persona={aurum}
        displayName="Chris"
        expanded={false}
        onToggleExpand={vi.fn()}
        onCopy={vi.fn()}
        onBookmark={vi.fn()}
        isStreamingDraft={false}
      />,
    );
    const after = container.querySelectorAll('.msg-text > span');
    expect(after.length).toBe(2);
    expect(after[0]?.className).toBe('');
    expect(after[1]?.className).toBe('');
  });

  it('renders contentBlocks in order with pills inline', () => {
    const pill: PillRow = {
      id: 'p1',
      messageId: 'm-p',
      kind: 'tool-call',
      positionHint: 'inline',
      status: 'completed',
      payload: { name: 'web_search' },
      createdAt: 1,
    };
    const msg = personaMsg({
      contentBlocks: [
        { type: 'text', text: 'first ' },
        { type: 'pill', pillId: 'p1' },
        { type: 'text', text: ' last' },
      ],
    });
    const { container } = render(
      <MessageBlock
        message={msg}
        pills={new Map([['p1', pill]])}
        persona={aurum}
        displayName="Chris"
        expanded={false}
        onToggleExpand={vi.fn()}
        onCopy={vi.fn()}
        onBookmark={vi.fn()}
      />,
    );
    const text = container.querySelector('.msg-text')?.textContent ?? '';
    expect(text.indexOf('first')).toBeLessThan(text.indexOf('web_search'));
    expect(text.indexOf('web_search')).toBeLessThan(text.indexOf('last'));
  });

  it('expanded state shows timestamp and controls', () => {
    const { container } = render(
      <MessageBlock
        message={personaMsg()}
        pills={new Map()}
        persona={aurum}
        displayName="Chris"
        expanded={true}
        onToggleExpand={vi.fn()}
        onCopy={vi.fn()}
        onBookmark={vi.fn()}
        onRegenerate={vi.fn()}
      />,
    );
    expect(container.querySelector('.msg.expanded')).not.toBeNull();
    expect(container.querySelector('.msg-timestamp')).not.toBeNull();
    expect(container.querySelector('.msg-controls')).not.toBeNull();
  });

  it('collapsed state hides controls', () => {
    const { container } = render(
      <MessageBlock
        message={personaMsg()}
        pills={new Map()}
        persona={aurum}
        displayName="Chris"
        expanded={false}
        onToggleExpand={vi.fn()}
        onCopy={vi.fn()}
        onBookmark={vi.fn()}
      />,
    );
    expect(container.querySelector('.msg-controls')).toBeNull();
  });

  it('tap on block toggles expand', () => {
    const onToggle = vi.fn();
    const { container } = render(
      <MessageBlock
        message={personaMsg()}
        pills={new Map()}
        persona={aurum}
        displayName="Chris"
        expanded={false}
        onToggleExpand={onToggle}
        onCopy={vi.fn()}
        onBookmark={vi.fn()}
      />,
    );
    // biome-ignore lint/style/noNonNullAssertion: .msg is always present when MessageBlock renders
    fireEvent.click(container.querySelector('.msg')!);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('Branch button is disabled with tooltip', () => {
    const { container } = render(
      <MessageBlock
        message={personaMsg()}
        pills={new Map()}
        persona={aurum}
        displayName="Chris"
        expanded={true}
        onToggleExpand={vi.fn()}
        onCopy={vi.fn()}
        onBookmark={vi.fn()}
        onRegenerate={vi.fn()}
      />,
    );
    const branch = container.querySelector('[data-ctrl="branch"]') as HTMLButtonElement | null;
    expect(branch?.disabled).toBe(true);
    expect(branch?.title).toMatch(/branching/i);
  });

  it('Read button is disabled with tooltip', () => {
    const { container } = render(
      <MessageBlock
        message={personaMsg()}
        pills={new Map()}
        persona={aurum}
        displayName="Chris"
        expanded={true}
        onToggleExpand={vi.fn()}
        onCopy={vi.fn()}
        onBookmark={vi.fn()}
        onRegenerate={vi.fn()}
      />,
    );
    const read = container.querySelector('[data-ctrl="read"]') as HTMLButtonElement | null;
    expect(read?.disabled).toBe(true);
    expect(read?.title).toMatch(/voice|block 4/i);
  });

  it('Regenerate hidden when prop missing', () => {
    const { container } = render(
      <MessageBlock
        message={personaMsg()}
        pills={new Map()}
        persona={aurum}
        displayName="Chris"
        expanded={true}
        onToggleExpand={vi.fn()}
        onCopy={vi.fn()}
        onBookmark={vi.fn()}
      />,
    );
    expect(container.querySelector('[data-ctrl="regenerate"]')).toBeNull();
  });

  it('Copy emits onCopy', () => {
    const onCopy = vi.fn();
    const { container } = render(
      <MessageBlock
        message={personaMsg()}
        pills={new Map()}
        persona={aurum}
        displayName="Chris"
        expanded={true}
        onToggleExpand={vi.fn()}
        onCopy={onCopy}
        onBookmark={vi.fn()}
      />,
    );
    const btn = container.querySelector('[data-ctrl="copy"]') as HTMLButtonElement;
    fireEvent.click(btn);
    expect(onCopy).toHaveBeenCalledTimes(1);
  });

  it('Bookmark toggle visual reflects message.bookmarked', () => {
    const { container, rerender } = render(
      <MessageBlock
        message={personaMsg({ bookmarked: false })}
        pills={new Map()}
        persona={aurum}
        displayName="Chris"
        expanded={true}
        onToggleExpand={vi.fn()}
        onCopy={vi.fn()}
        onBookmark={vi.fn()}
      />,
    );
    expect(container.querySelector('[data-ctrl="bookmark"][data-active="true"]')).toBeNull();
    rerender(
      <MessageBlock
        message={personaMsg({ bookmarked: true })}
        pills={new Map()}
        persona={aurum}
        displayName="Chris"
        expanded={true}
        onToggleExpand={vi.fn()}
        onCopy={vi.fn()}
        onBookmark={vi.fn()}
      />,
    );
    expect(container.querySelector('[data-ctrl="bookmark"][data-active="true"]')).not.toBeNull();
  });
});
