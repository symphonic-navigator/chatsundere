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
  it('user variant renders display name', () => {
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
    expect(container.textContent).toContain('Chris');
    expect(container.textContent).toContain('hello');
  });

  it('persona variant renders persona name in persona colour and font', () => {
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
    expect(container.textContent).toContain('Aurum');
    const nameEl = container.querySelector('.msg-name') as HTMLElement | null;
    expect(nameEl?.style.color.replace(/\s/g, '')).toBe('rgb(201,168,76)');
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
