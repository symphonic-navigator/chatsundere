import { getOffering } from '@chatsundere/llm-unified';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { PersonaRow } from '../../src/boot/client-data-db';
import { _resetClientDataDbForTests, openClientDataDb } from '../../src/boot/client-data-db.js';
import { InteractionTopbar } from '../../src/components/chat/InteractionTopbar';
import { displayTitle } from '../../src/lib/chat-title';

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

const chatRow: import('../../src/boot/client-data-db').ChatRow = {
  id: 'c1',
  personaId: 'p1',
  title: null,
  resolvedMindspaceId: 'm1',
  createdAt: new Date('2026-05-26T10:00:00').getTime(),
  lastMessageAt: 0,
  bookmarkedMessageCount: 0,
  draftInput: '',
  libraryIds: [],
};

beforeEach(async () => {
  await _resetClientDataDbForTests();
  await openClientDataDb();
});
afterEach(async () => {
  await _resetClientDataDbForTests();
});

function wrap(node: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>{node}</MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('InteractionTopbar', () => {
  it('hamburger triggers onExit', () => {
    const onExit = vi.fn();
    const { container } = wrap(
      <InteractionTopbar
        persona={aurum}
        chat={chatRow}
        usedTokens={0}
        contextWindow={1000}
        onExit={onExit}
        onRenameChat={vi.fn()}
      />,
    );
    const btn = container.querySelector('.hamburger-btn') as HTMLButtonElement;
    fireEvent.click(btn);
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('journal stub shows 0', () => {
    const { container } = wrap(
      <InteractionTopbar
        persona={aurum}
        chat={chatRow}
        usedTokens={0}
        contextWindow={1000}
        onExit={vi.fn()}
        onRenameChat={vi.fn()}
      />,
    );
    expect(container.querySelector('.journal-indicator')?.textContent).toContain('0');
  });

  it('context gauge shows the right percentage', () => {
    const { container } = wrap(
      <InteractionTopbar
        persona={aurum}
        chat={chatRow}
        usedTokens={250}
        contextWindow={1000}
        onExit={vi.fn()}
        onRenameChat={vi.fn()}
      />,
    );
    expect(container.querySelector('.context-gauge-text')?.textContent).toBe('25%');
    const fill = container.querySelector('.context-gauge-fill') as HTMLElement;
    expect(fill.style.width).toBe('25%');
  });

  it('context gauge caps at 100', () => {
    const { container } = wrap(
      <InteractionTopbar
        persona={aurum}
        chat={chatRow}
        usedTokens={5000}
        contextWindow={1000}
        onExit={vi.fn()}
        onRenameChat={vi.fn()}
      />,
    );
    expect(container.querySelector('.context-gauge-text')?.textContent).toBe('100%');
  });
});

describe('InteractionTopbar — title row (chat exists)', () => {
  it('renders displayTitle(chat) as a tappable button with a pencil glyph', () => {
    const { container } = wrap(
      <InteractionTopbar
        persona={aurum}
        chat={chatRow}
        usedTokens={0}
        contextWindow={1000}
        onExit={vi.fn()}
        onRenameChat={vi.fn()}
      />,
    );
    const titleBtn = container.querySelector('.topbar-title-btn') as HTMLButtonElement;
    expect(titleBtn).not.toBeNull();
    expect(titleBtn.textContent).toContain(displayTitle(chatRow));
    expect(titleBtn.querySelector('.topbar-pencil')).not.toBeNull();
  });

  it('the avatar is the tap target into persona settings', () => {
    const onOpen = vi.fn();
    const { container } = wrap(
      <InteractionTopbar
        persona={aurum}
        chat={chatRow}
        usedTokens={0}
        contextWindow={1000}
        onExit={vi.fn()}
        onRenameChat={vi.fn()}
        onOpenPersonaEditor={onOpen}
      />,
    );
    const avatarBtn = container.querySelector('.topbar-avatar-btn') as HTMLButtonElement;
    expect(avatarBtn).not.toBeNull();
    expect(avatarBtn.getAttribute('aria-label')).toContain('Aurum');
    fireEvent.click(avatarBtn);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('no longer renders the persona name as text', () => {
    const { container } = wrap(
      <InteractionTopbar
        persona={aurum}
        chat={chatRow}
        usedTokens={0}
        contextWindow={1000}
        onExit={vi.fn()}
        onRenameChat={vi.fn()}
        onOpenPersonaEditor={vi.fn()}
      />,
    );
    expect(container.querySelector('.topbar-persona-name-btn')).toBeNull();
  });

  it('project slot shows a muted placeholder when no project', () => {
    const { container } = wrap(
      <InteractionTopbar
        persona={aurum}
        chat={chatRow}
        usedTokens={0}
        contextWindow={1000}
        onExit={vi.fn()}
        onRenameChat={vi.fn()}
      />,
    );
    const slot = container.querySelector('.topbar-project') as HTMLElement;
    expect(slot).not.toBeNull();
    expect(slot.textContent).toBe('(no project)');
    expect(slot.getAttribute('data-empty')).toBe('true');
  });

  it('project slot shows the project name (no placeholder) when set', () => {
    const { container } = wrap(
      <InteractionTopbar
        persona={aurum}
        chat={chatRow}
        usedTokens={0}
        contextWindow={1000}
        onExit={vi.fn()}
        onRenameChat={vi.fn()}
        projectName="Rennwagen"
      />,
    );
    const slot = container.querySelector('.topbar-project') as HTMLElement;
    expect(slot.textContent).toBe('Rennwagen');
    expect(slot.getAttribute('data-empty')).toBeNull();
  });

  it('tapping the title swaps to an input pre-filled with the current title (or empty when null)', () => {
    const { container } = wrap(
      <InteractionTopbar
        persona={aurum}
        chat={chatRow}
        usedTokens={0}
        contextWindow={1000}
        onExit={vi.fn()}
        onRenameChat={vi.fn()}
      />,
    );
    fireEvent.click(container.querySelector('.topbar-title-btn') as HTMLButtonElement);
    const input = container.querySelector('.topbar-title-input') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.value).toBe('');
    expect(input.getAttribute('maxlength')).toBe('60');
  });

  it('Enter commits sanitised value via onRenameChat', () => {
    const onRename = vi.fn();
    const { container } = wrap(
      <InteractionTopbar
        persona={aurum}
        chat={chatRow}
        usedTokens={0}
        contextWindow={1000}
        onExit={vi.fn()}
        onRenameChat={onRename}
      />,
    );
    fireEvent.click(container.querySelector('.topbar-title-btn') as HTMLButtonElement);
    const input = container.querySelector('.topbar-title-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '  My new title  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onRename).toHaveBeenCalledWith('My new title');
  });

  it('Escape cancels without invoking onRenameChat', () => {
    const onRename = vi.fn();
    const { container } = wrap(
      <InteractionTopbar
        persona={aurum}
        chat={chatRow}
        usedTokens={0}
        contextWindow={1000}
        onExit={vi.fn()}
        onRenameChat={onRename}
      />,
    );
    fireEvent.click(container.querySelector('.topbar-title-btn') as HTMLButtonElement);
    const input = container.querySelector('.topbar-title-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'discard me' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onRename).not.toHaveBeenCalled();
    expect(container.querySelector('.topbar-title-input')).toBeNull();
  });

  it('Blur commits the sanitised value', () => {
    const onRename = vi.fn();
    const { container } = wrap(
      <InteractionTopbar
        persona={aurum}
        chat={chatRow}
        usedTokens={0}
        contextWindow={1000}
        onExit={vi.fn()}
        onRenameChat={onRename}
      />,
    );
    fireEvent.click(container.querySelector('.topbar-title-btn') as HTMLButtonElement);
    const input = container.querySelector('.topbar-title-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'blurred title' } });
    fireEvent.blur(input);
    expect(onRename).toHaveBeenCalledWith('blurred title');
  });

  it('empty / whitespace-only commits null (= back to fallback)', () => {
    const onRename = vi.fn();
    const { container } = wrap(
      <InteractionTopbar
        persona={aurum}
        chat={{ ...chatRow, title: 'existing' }}
        usedTokens={0}
        contextWindow={1000}
        onExit={vi.fn()}
        onRenameChat={onRename}
      />,
    );
    fireEvent.click(container.querySelector('.topbar-title-btn') as HTMLButtonElement);
    const input = container.querySelector('.topbar-title-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onRename).toHaveBeenCalledWith(null);
  });
});

describe('InteractionTopbar — lazy mode (no chat yet)', () => {
  it('renders "New chat" placeholder when chat is null, no pencil, not interactive', () => {
    const { container } = wrap(
      <InteractionTopbar
        persona={aurum}
        chat={null}
        usedTokens={0}
        contextWindow={1000}
        onExit={vi.fn()}
        onRenameChat={vi.fn()}
      />,
    );
    const placeholder = container.querySelector('.topbar-title-placeholder') as HTMLElement;
    expect(placeholder).not.toBeNull();
    expect(placeholder.textContent).toContain('New chat');
    expect(container.querySelector('.topbar-pencil')).toBeNull();
    expect(container.querySelector('.topbar-title-btn')).toBeNull();
  });

  it('avatar tap into persona settings remains functional in lazy mode', () => {
    const onOpen = vi.fn();
    const { container } = wrap(
      <InteractionTopbar
        persona={aurum}
        chat={null}
        usedTokens={0}
        contextWindow={1000}
        onExit={vi.fn()}
        onRenameChat={vi.fn()}
        onOpenPersonaEditor={onOpen}
      />,
    );
    fireEvent.click(container.querySelector('.topbar-avatar-btn') as HTMLButtonElement);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

import { InteractionMode } from '../../src/components/chat/InteractionMode';

// nano-gpt deepseek-v4-flash offering for InteractionMode plumbing test
// biome-ignore lint/style/noNonNullAssertion: test fixture — this slug is guaranteed to exist in the catalogue
const imOffering = getOffering('nano-gpt', 'deepseek/deepseek-v4-flash')!;

describe('InteractionMode → InteractionTopbar plumbing', () => {
  it('forwards `chat` and `onRenameChat` to the Topbar', () => {
    const onRename = vi.fn();
    const { container } = wrap(
      <InteractionMode
        persona={aurum}
        chatId="c1"
        chat={chatRow}
        offering={imOffering}
        usedTokens={0}
        draftValue=""
        onDraftChange={vi.fn()}
        isStreamLive={false}
        isSending={false}
        onSend={vi.fn()}
        onExit={vi.fn()}
        onRenameChat={onRename}
        onOpenPersonaEditor={vi.fn()}
      />,
    );
    fireEvent.click(container.querySelector('.topbar-title-btn') as HTMLButtonElement);
    const input = container.querySelector('.topbar-title-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'piped through' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onRename).toHaveBeenCalledWith('piped through');
  });
});
