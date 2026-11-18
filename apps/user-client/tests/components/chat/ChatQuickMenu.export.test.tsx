// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  ChatQuickMenu,
  type ChatQuickMenuProps,
} from '../../../src/components/chat/ChatQuickMenu.js';

vi.mock('../../../src/components/PersonaAvatar.js', () => ({
  PersonaAvatar: ({ name }: { name: string }) => <span>{name.slice(0, 1)}</span>,
}));

function setup(over: Partial<ChatQuickMenuProps> = {}) {
  const props: ChatQuickMenuProps = {
    anchor: { top: 10, left: 12, bottom: 40 },
    persona: { id: 'p1', name: 'Fable', colour: '#c9a84c' },
    activeChatId: 'c1',
    returnTo: '/app/chat/c1',
    onClose: vi.fn(),
    onEntranceHall: vi.fn(),
    onNavigate: vi.fn(),
    exportState: 'ready',
    onExport: vi.fn(),
    ...over,
  };
  render(<ChatQuickMenu {...props} />);
  return props;
}

const exportItem = () => screen.getByRole('menuitem', { name: /Export chat/ });

describe('ChatQuickMenu — Export chat', () => {
  it('sits in its own group between the persona group and Image settings', () => {
    setup();
    const labels = screen.getAllByRole('menuitem').map((el) => el.textContent?.trim());
    expect(labels.indexOf('Export chat')).toBe(labels.indexOf('Knowledge') + 1);
    expect(labels.indexOf('Image settings')).toBe(labels.indexOf('Export chat') + 1);
    const group = exportItem().parentElement;
    expect(group?.children).toHaveLength(1);
  });

  it('is enabled without a note when ready, and a tap closes the menu and exports', () => {
    const p = setup();
    expect(exportItem()).not.toHaveAttribute('aria-disabled');
    expect(exportItem().textContent).toBe('Export chat');
    fireEvent.click(exportItem());
    expect(p.onClose).toHaveBeenCalledTimes(1);
    expect(p.onExport).toHaveBeenCalledTimes(1);
  });

  it('is disabled with a visible reason for an empty chat', () => {
    const p = setup({ exportState: 'empty' });
    expect(exportItem()).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('Nothing to export yet')).toBeVisible();
    fireEvent.click(exportItem());
    expect(p.onExport).not.toHaveBeenCalled();
  });

  it('is disabled while the rows load', () => {
    const p = setup({ exportState: 'preparing' });
    expect(exportItem()).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('Preparing…')).toBeVisible();
    fireEvent.click(exportItem());
    expect(p.onExport).not.toHaveBeenCalled();
  });

  it('stays enabled while a reply streams, saying the reply is left out', () => {
    const p = setup({ exportState: 'streaming' });
    expect(exportItem()).not.toHaveAttribute('aria-disabled');
    expect(screen.getByText('The reply in progress is left out')).toBeVisible();
    fireEvent.click(exportItem());
    expect(p.onExport).toHaveBeenCalledTimes(1);
  });

  it('never explains itself in a tooltip', () => {
    setup({ exportState: 'empty' });
    expect(exportItem()).not.toHaveAttribute('title');
  });
});
