// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  ChatQuickMenu,
  type ChatQuickMenuProps,
} from '../../../src/components/chat/ChatQuickMenu.js';

// PersonaAvatar reads the avatar store from the DB; a stub keeps this test pure.
vi.mock('../../../src/components/PersonaAvatar.js', () => ({
  PersonaAvatar: ({ name }: { name: string }) => (
    <span data-testid="avatar">{name.slice(0, 1)}</span>
  ),
}));

const persona = { id: 'p1', name: 'Fable', colour: '#c9a84c' };

function setup(over: Partial<ChatQuickMenuProps> = {}) {
  const props: ChatQuickMenuProps = {
    anchor: { top: 10, left: 12, bottom: 40 },
    persona,
    activeChatId: 'c1',
    returnTo: '/app/chat/c1',
    onClose: vi.fn(),
    onEntranceHall: vi.fn(),
    onNavigate: vi.fn(),
    ...over,
  };
  render(<ChatQuickMenu {...props} />);
  return props;
}

const item = (name: string | RegExp) => screen.getByRole('menuitem', { name });
const enc = encodeURIComponent;

describe('ChatQuickMenu', () => {
  it('renders nothing while closed', () => {
    setup({ anchor: null });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('lists the seven entries in order', () => {
    setup();
    const labels = screen.getAllByRole('menuitem').map((el) => el.textContent?.trim());
    expect(labels).toEqual([
      'Entrance Hall',
      'FFable',
      'New chat with Fable',
      'Memories',
      'History',
      'Knowledge',
      'Image settings',
    ]);
  });

  it('focuses the first item on open', () => {
    setup();
    expect(item('Entrance Hall')).toHaveFocus();
  });

  it('Entrance Hall uses the exit handler, then closes', () => {
    const p = setup();
    fireEvent.click(item('Entrance Hall'));
    expect(p.onEntranceHall).toHaveBeenCalledTimes(1);
    expect(p.onClose).toHaveBeenCalled();
    expect(p.onNavigate).not.toHaveBeenCalled();
  });

  it.each([
    [/^(F\s?)?Fable$/, `/app/persona/p1?return=${enc('/app/chat/c1')}`],
    ['New chat with Fable', '/app/chat/new?personaId=p1'],
    ['Memories', '/app/persona/p1/memory?chat=c1'],
    ['History', `/app/history?personaId=p1&return=${enc('/app/chat/c1')}`],
    ['Knowledge', `/app/persona/p1/knowledge?return=${enc('/app/chat/c1')}`],
    ['Image settings', `/app/settings/images?return=${enc('/app/chat/c1')}`],
  ])('%s navigates to %s and closes', (name, to) => {
    const p = setup();
    fireEvent.click(item(name));
    expect(p.onNavigate).toHaveBeenCalledWith(to);
    expect(p.onClose).toHaveBeenCalled();
  });

  it('in a lazy chat: entries enabled, New chat disabled with a visible reason, return keeps personaId', () => {
    const returnTo = '/app/chat/new?personaId=p1';
    const p = setup({ activeChatId: null, returnTo });
    expect(item(/new chat with fable/i)).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText("You're in a new chat")).toBeInTheDocument();
    fireEvent.click(item(/new chat with fable/i));
    expect(p.onNavigate).not.toHaveBeenCalled();
    fireEvent.click(item('Memories'));
    expect(p.onNavigate).toHaveBeenCalledWith(`/app/persona/p1/memory?return=${enc(returnTo)}`);
    fireEvent.click(item('Knowledge'));
    expect(p.onNavigate).toHaveBeenCalledWith(`/app/persona/p1/knowledge?return=${enc(returnTo)}`);
  });

  it('while the persona resolves: persona group disabled with Loading persona…', () => {
    const p = setup({ persona: null });
    expect(screen.getByText('Loading persona…')).toBeInTheDocument();
    expect(item('Memories')).toHaveAttribute('aria-disabled', 'true');
    // Disabled over hidden: the menu keeps its loaded shape while resolving.
    expect(item('New chat')).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getAllByRole('menuitem').map((el) => el.textContent?.trim())).toEqual([
      'Entrance Hall',
      'PersonaLoading persona…',
      'New chat',
      'Memories',
      'History',
      'Knowledge',
      'Image settings',
    ]);
    fireEvent.click(item('New chat'));
    expect(item('Entrance Hall')).not.toHaveAttribute('aria-disabled');
    expect(item('Image settings')).not.toHaveAttribute('aria-disabled');
    fireEvent.click(item('Memories'));
    expect(p.onNavigate).not.toHaveBeenCalled();
  });

  it('backdrop tap closes', () => {
    const p = setup();
    fireEvent.click(screen.getByTestId('quick-menu-backdrop'));
    expect(p.onClose).toHaveBeenCalledTimes(1);
  });

  it('Escape closes and does not reach other listeners', () => {
    const outer = vi.fn();
    window.addEventListener('keydown', outer);
    const p = setup();
    fireEvent.keyDown(item('Entrance Hall'), { key: 'Escape' });
    expect(p.onClose).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
    window.removeEventListener('keydown', outer);
  });

  it('ArrowDown and ArrowUp move focus over enabled items, wrapping', () => {
    setup();
    fireEvent.keyDown(item('Entrance Hall'), { key: 'ArrowDown' });
    expect(item(/^(F\s?)?Fable$/)).toHaveFocus();
    fireEvent.keyDown(item(/^(F\s?)?Fable$/), { key: 'ArrowUp' });
    expect(item('Entrance Hall')).toHaveFocus();
    fireEvent.keyDown(item('Entrance Hall'), { key: 'ArrowUp' });
    expect(item('Image settings')).toHaveFocus();
  });

  it('the portal root carries the cockpit-exemption class', () => {
    setup();
    expect(document.querySelector('.chat-quick-menu-root')).not.toBeNull();
  });

  describe('focus return on dismiss', () => {
    function mountTrigger() {
      const root = document.createElement('div');
      root.id = 'root';
      const trigger = document.createElement('button');
      root.appendChild(trigger);
      document.body.appendChild(root);
      trigger.focus();
      const inertAtFocus: boolean[] = [];
      trigger.addEventListener('focus', () => inertAtFocus.push(root.hasAttribute('inert')));
      return { root, trigger, inertAtFocus };
    }

    it.each([
      ['Escape', () => fireEvent.keyDown(item('Entrance Hall'), { key: 'Escape' })],
      ['a backdrop tap', () => fireEvent.click(screen.getByTestId('quick-menu-backdrop'))],
    ])('after %s the trigger regains focus once #root is no longer inert', (_name, dismiss) => {
      const { root, trigger, inertAtFocus } = mountTrigger();
      try {
        setup();
        expect(root).toHaveAttribute('inert');
        inertAtFocus.length = 0;
        dismiss();
        expect(inertAtFocus).toEqual([false]);
        expect(trigger).toHaveFocus();
      } finally {
        root.remove();
      }
    });
  });
});
