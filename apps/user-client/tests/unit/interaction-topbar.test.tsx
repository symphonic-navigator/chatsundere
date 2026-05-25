import { fireEvent, render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { PersonaRow } from '../../src/boot/client-data-db';
import { InteractionTopbar } from '../../src/components/chat/InteractionTopbar';

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

describe('InteractionTopbar', () => {
  it('hamburger triggers onExit', () => {
    const onExit = vi.fn();
    const { container } = render(
      <MemoryRouter>
        <InteractionTopbar persona={aurum} usedTokens={0} contextWindow={1000} onExit={onExit} />
      </MemoryRouter>,
    );
    const btn = container.querySelector('.hamburger-btn') as HTMLButtonElement;
    fireEvent.click(btn);
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it('renders "Chat with" + persona name in persona colour', () => {
    const { container } = render(
      <MemoryRouter>
        <InteractionTopbar persona={aurum} usedTokens={0} contextWindow={1000} onExit={vi.fn()} />
      </MemoryRouter>,
    );
    expect(container.textContent).toContain('Chat with');
    const nameEl = container.querySelector('.context-name') as HTMLElement;
    expect(nameEl.textContent).toBe('Aurum');
    expect(nameEl.style.color.replace(/\s/g, '')).toBe('rgb(201,168,76)');
  });

  it('journal stub shows 0', () => {
    const { container } = render(
      <MemoryRouter>
        <InteractionTopbar persona={aurum} usedTokens={0} contextWindow={1000} onExit={vi.fn()} />
      </MemoryRouter>,
    );
    expect(container.querySelector('.journal-indicator')?.textContent).toContain('0');
  });

  it('context gauge shows the right percentage', () => {
    const { container } = render(
      <MemoryRouter>
        <InteractionTopbar persona={aurum} usedTokens={250} contextWindow={1000} onExit={vi.fn()} />
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
          usedTokens={5000}
          contextWindow={1000}
          onExit={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(container.querySelector('.context-gauge-text')?.textContent).toBe('100%');
  });

  it('persona-name button fires onOpenPersonaEditor when callback is provided', () => {
    const onOpenPersonaEditor = vi.fn();
    const { container } = render(
      <MemoryRouter>
        <InteractionTopbar
          persona={aurum}
          usedTokens={0}
          contextWindow={1000}
          onExit={vi.fn()}
          onOpenPersonaEditor={onOpenPersonaEditor}
        />
      </MemoryRouter>,
    );
    const btn = container.querySelector('.topbar-center-btn') as HTMLButtonElement;
    expect(btn).not.toBeNull();
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    expect(onOpenPersonaEditor).toHaveBeenCalledTimes(1);
  });

  it('persona-name button is disabled when no onOpenPersonaEditor callback', () => {
    const { container } = render(
      <MemoryRouter>
        <InteractionTopbar persona={aurum} usedTokens={0} contextWindow={1000} onExit={vi.fn()} />
      </MemoryRouter>,
    );
    const btn = container.querySelector('.topbar-center-btn') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });
});
