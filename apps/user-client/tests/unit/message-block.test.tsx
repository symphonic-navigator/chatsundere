import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MessageRow, PersonaRow, PillRow } from '../../src/boot/client-data-db';
import { MessageBlock } from '../../src/components/chat/MessageBlock';
import type { ResolvedMindspace } from '../../src/state/mindspace-resolver';

// Minimal stub — MessageBlock forwards the resolved mindspace to ReasoningPill,
// which today reads only the CSS var written by an ancestor MindspaceLayer.
// A cast keeps the type contract intact without pinning the full shape here.
const mindspaceStub = {} as ResolvedMindspace;

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
  canonicalId: null,
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
        mindspace={mindspaceStub}
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
        mindspace={mindspaceStub}
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
        mindspace={mindspaceStub}
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
        mindspace={mindspaceStub}
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

  it('renders adjacent text chunks as joined markdown with no token-fade class', () => {
    const msg = personaMsg({
      contentBlocks: [
        { type: 'text', text: 'Hi' },
        { type: 'text', text: ' world' },
      ],
    });
    const { container } = render(
      <MessageBlock
        message={msg}
        pills={new Map()}
        mindspace={mindspaceStub}
        persona={aurum}
        displayName="Chris"
        expanded={false}
        onToggleExpand={vi.fn()}
        onCopy={vi.fn()}
        onBookmark={vi.fn()}
        isStreamingDraft={true}
      />,
    );
    // Text blocks in a group are concatenated and rendered as Markdown — the
    // two chunks become one continuous string, not two fade-in spans.
    const text = container.querySelector('.msg-text') as HTMLElement;
    expect(text.textContent).toBe('Hi world');
    // The per-token fade-in mechanism has been removed.
    expect(container.querySelector('.token-fade')).toBeNull();
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
        mindspace={mindspaceStub}
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
        mindspace={mindspaceStub}
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
        mindspace={mindspaceStub}
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
        mindspace={mindspaceStub}
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

  it('Branch button is disabled while a stream is live', () => {
    const { container } = render(
      <MessageBlock
        message={personaMsg()}
        pills={new Map()}
        mindspace={mindspaceStub}
        persona={aurum}
        displayName="Chris"
        expanded={true}
        onToggleExpand={vi.fn()}
        onCopy={vi.fn()}
        onBookmark={vi.fn()}
        onRegenerate={vi.fn()}
        onBranch={vi.fn()}
        branchDisabled
      />,
    );
    const branch = container.querySelector('[data-ctrl="branch"]') as HTMLButtonElement | null;
    expect(branch?.disabled).toBe(true);
    expect(branch?.title).toMatch(/branching paused/i);
  });

  it('Read button is disabled with tooltip', () => {
    const { container } = render(
      <MessageBlock
        message={personaMsg()}
        pills={new Map()}
        mindspace={mindspaceStub}
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
        mindspace={mindspaceStub}
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
        mindspace={mindspaceStub}
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
        mindspace={mindspaceStub}
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
        mindspace={mindspaceStub}
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

describe('<MessageBlock> reasoning rendering', () => {
  it('renders a single ReasoningPill for a maximal reasoning run', () => {
    const message: MessageRow = {
      id: 'm-r1',
      chatId: 'c1',
      role: 'persona',
      contentBlocks: [
        { type: 'reasoning', text: 'plan A. ' },
        { type: 'reasoning', text: 'plan B.' },
        { type: 'text', text: 'Result: ready' },
      ],
      streamingState: 'complete',
      bookmarked: false,
      createdAt: Date.now(),
    };
    render(
      <MessageBlock
        message={message}
        pills={new Map()}
        mindspace={mindspaceStub}
        persona={aurum}
        displayName="Chris"
        expanded={false}
        onToggleExpand={vi.fn()}
        onCopy={vi.fn()}
        onBookmark={vi.fn()}
        isStreamingDraft={false}
      />,
    );
    const pills = document.querySelectorAll('.reasoning-pill');
    expect(pills.length).toBe(1);
    expect(screen.getByText(/result/i)).toBeInTheDocument();
  });

  it('renders two ReasoningPills for interleaved reasoning-text-reasoning-text', () => {
    const message: MessageRow = {
      id: 'm-r2',
      chatId: 'c1',
      role: 'persona',
      contentBlocks: [
        { type: 'reasoning', text: 'think 1' },
        { type: 'text', text: 'partial answer' },
        { type: 'reasoning', text: 'think 2' },
        { type: 'text', text: 'final answer' },
      ],
      streamingState: 'complete',
      bookmarked: false,
      createdAt: Date.now(),
    };
    render(
      <MessageBlock
        message={message}
        pills={new Map()}
        mindspace={mindspaceStub}
        persona={aurum}
        displayName="Chris"
        expanded={false}
        onToggleExpand={vi.fn()}
        onCopy={vi.fn()}
        onBookmark={vi.fn()}
        isStreamingDraft={false}
      />,
    );
    expect(document.querySelectorAll('.reasoning-pill').length).toBe(2);
  });

  it('marks only the LAST reasoning pill as data-live="true" when streaming', () => {
    // The MessageRow.streamingState union is binary ('complete' | 'incomplete')
    // — liveness is driven by the `isStreamingDraft` prop, not the row field.
    const message: MessageRow = {
      id: 'm-r3',
      chatId: 'c1',
      role: 'persona',
      contentBlocks: [
        { type: 'reasoning', text: 't1' },
        { type: 'text', text: 'answer' },
        { type: 'reasoning', text: 't2' },
      ],
      streamingState: 'incomplete',
      bookmarked: false,
      createdAt: Date.now(),
    };
    render(
      <MessageBlock
        message={message}
        pills={new Map()}
        mindspace={mindspaceStub}
        persona={aurum}
        displayName="Chris"
        expanded={false}
        onToggleExpand={vi.fn()}
        onCopy={vi.fn()}
        onBookmark={vi.fn()}
        isStreamingDraft={true}
      />,
    );
    const pills = document.querySelectorAll('.reasoning-pill');
    expect(pills.length).toBe(2);
    expect(pills[0]?.getAttribute('data-live')).toBe('false');
    expect(pills[1]?.getAttribute('data-live')).toBe('true');
  });
});
