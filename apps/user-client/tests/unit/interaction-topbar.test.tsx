import { getOffering } from '@chatsundere/llm-unified';
import { fireEvent, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { PersonaRow } from '../../src/boot/client-data-db';
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
};

describe('InteractionTopbar', () => {
  it('hamburger triggers onExit', () => {
    const onExit = vi.fn();
    const { container } = render(
      <MemoryRouter>
        <InteractionTopbar
          persona={aurum}
          chat={chatRow}
          usedTokens={0}
          contextWindow={1000}
          onExit={onExit}
          onRenameChat={vi.fn()}
        />
      </MemoryRouter>,
    );
    const btn = container.querySelector('.hamburger-btn') as HTMLButtonElement;
    fireEvent.click(btn);
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('journal stub shows 0', () => {
    const { container } = render(
      <MemoryRouter>
        <InteractionTopbar
          persona={aurum}
          chat={chatRow}
          usedTokens={0}
          contextWindow={1000}
          onExit={vi.fn()}
          onRenameChat={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(container.querySelector('.journal-indicator')?.textContent).toContain('0');
  });

  it('context gauge shows the right percentage', () => {
    const { container } = render(
      <MemoryRouter>
        <InteractionTopbar
          persona={aurum}
          chat={chatRow}
          usedTokens={250}
          contextWindow={1000}
          onExit={vi.fn()}
          onRenameChat={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(container.querySelector('.context-gauge-text')?.textContent).toBe('25%');
    const fill = container.querySelector('.context-gauge-fill') as HTMLElement;
    expect(fill.style.width).toBe('25%');
  });

  it('context gauge caps at 100', () => {
    const { container } = render(
      <MemoryRouter>
        <InteractionTopbar
          persona={aurum}
          chat={chatRow}
          usedTokens={5000}
          contextWindow={1000}
          onExit={vi.fn()}
          onRenameChat={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(container.querySelector('.context-gauge-text')?.textContent).toBe('100%');
  });
});

describe('InteractionTopbar — title row (chat exists)', () => {
  it('renders displayTitle(chat) as a tappable button with a pencil glyph', () => {
    const { container } = render(
      <MemoryRouter>
        <InteractionTopbar
          persona={aurum}
          chat={chatRow}
          usedTokens={0}
          contextWindow={1000}
          onExit={vi.fn()}
          onRenameChat={vi.fn()}
        />
      </MemoryRouter>,
    );
    const titleBtn = container.querySelector('.topbar-title-btn') as HTMLButtonElement;
    expect(titleBtn).not.toBeNull();
    expect(titleBtn.textContent).toContain(displayTitle(chatRow));
    expect(titleBtn.querySelector('.topbar-pencil')).not.toBeNull();
  });

  it('renders persona-name row below title as a separate tap target', () => {
    const onOpen = vi.fn();
    const { container } = render(
      <MemoryRouter>
        <InteractionTopbar
          persona={aurum}
          chat={chatRow}
          usedTokens={0}
          contextWindow={1000}
          onExit={vi.fn()}
          onRenameChat={vi.fn()}
          onOpenPersonaEditor={onOpen}
        />
      </MemoryRouter>,
    );
    const personaBtn = container.querySelector('.topbar-persona-name-btn') as HTMLButtonElement;
    expect(personaBtn).not.toBeNull();
    expect(personaBtn.textContent).toContain('Aurum');
    fireEvent.click(personaBtn);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('tapping the title swaps to an input pre-filled with the current title (or empty when null)', () => {
    const { container } = render(
      <MemoryRouter>
        <InteractionTopbar
          persona={aurum}
          chat={chatRow}
          usedTokens={0}
          contextWindow={1000}
          onExit={vi.fn()}
          onRenameChat={vi.fn()}
        />
      </MemoryRouter>,
    );
    fireEvent.click(container.querySelector('.topbar-title-btn') as HTMLButtonElement);
    const input = container.querySelector('.topbar-title-input') as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.value).toBe('');
    expect(input.getAttribute('maxlength')).toBe('60');
  });

  it('Enter commits sanitised value via onRenameChat', () => {
    const onRename = vi.fn();
    const { container } = render(
      <MemoryRouter>
        <InteractionTopbar
          persona={aurum}
          chat={chatRow}
          usedTokens={0}
          contextWindow={1000}
          onExit={vi.fn()}
          onRenameChat={onRename}
        />
      </MemoryRouter>,
    );
    fireEvent.click(container.querySelector('.topbar-title-btn') as HTMLButtonElement);
    const input = container.querySelector('.topbar-title-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '  My new title  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onRename).toHaveBeenCalledWith('My new title');
  });

  it('Escape cancels without invoking onRenameChat', () => {
    const onRename = vi.fn();
    const { container } = render(
      <MemoryRouter>
        <InteractionTopbar
          persona={aurum}
          chat={chatRow}
          usedTokens={0}
          contextWindow={1000}
          onExit={vi.fn()}
          onRenameChat={onRename}
        />
      </MemoryRouter>,
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
    const { container } = render(
      <MemoryRouter>
        <InteractionTopbar
          persona={aurum}
          chat={chatRow}
          usedTokens={0}
          contextWindow={1000}
          onExit={vi.fn()}
          onRenameChat={onRename}
        />
      </MemoryRouter>,
    );
    fireEvent.click(container.querySelector('.topbar-title-btn') as HTMLButtonElement);
    const input = container.querySelector('.topbar-title-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'blurred title' } });
    fireEvent.blur(input);
    expect(onRename).toHaveBeenCalledWith('blurred title');
  });

  it('empty / whitespace-only commits null (= back to fallback)', () => {
    const onRename = vi.fn();
    const { container } = render(
      <MemoryRouter>
        <InteractionTopbar
          persona={aurum}
          chat={{ ...chatRow, title: 'existing' }}
          usedTokens={0}
          contextWindow={1000}
          onExit={vi.fn()}
          onRenameChat={onRename}
        />
      </MemoryRouter>,
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
    const { container } = render(
      <MemoryRouter>
        <InteractionTopbar
          persona={aurum}
          chat={null}
          usedTokens={0}
          contextWindow={1000}
          onExit={vi.fn()}
          onRenameChat={vi.fn()}
        />
      </MemoryRouter>,
    );
    const placeholder = container.querySelector('.topbar-title-placeholder') as HTMLElement;
    expect(placeholder).not.toBeNull();
    expect(placeholder.textContent).toContain('New chat');
    expect(container.querySelector('.topbar-pencil')).toBeNull();
    expect(container.querySelector('.topbar-title-btn')).toBeNull();
  });

  it('persona-name row remains functional in lazy mode', () => {
    const onOpen = vi.fn();
    const { container } = render(
      <MemoryRouter>
        <InteractionTopbar
          persona={aurum}
          chat={null}
          usedTokens={0}
          contextWindow={1000}
          onExit={vi.fn()}
          onRenameChat={vi.fn()}
          onOpenPersonaEditor={onOpen}
        />
      </MemoryRouter>,
    );
    fireEvent.click(container.querySelector('.topbar-persona-name-btn') as HTMLButtonElement);
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
    const { container } = render(
      <MemoryRouter>
        <InteractionMode
          persona={aurum}
          chat={chatRow}
          offering={imOffering}
          usedTokens={0}
          draftValue=""
          onDraftChange={vi.fn()}
          isStreamLive={false}
          onSend={vi.fn()}
          onExit={vi.fn()}
          onRenameChat={onRename}
          onOpenPersonaEditor={vi.fn()}
        />
      </MemoryRouter>,
    );
    fireEvent.click(container.querySelector('.topbar-title-btn') as HTMLButtonElement);
    const input = container.querySelector('.topbar-title-input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'piped through' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onRename).toHaveBeenCalledWith('piped through');
  });
});
