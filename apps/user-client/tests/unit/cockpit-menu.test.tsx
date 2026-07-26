import type { ReasoningControl } from '@chatsundere/llm-unified';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CockpitMenu } from '../../src/components/chat/CockpitMenu.js';
import type { ReasoningState } from '../../src/lib/reasoning-resolver.js';

const noop = () => {};

function renderMenu(
  control: ReasoningControl,
  reasoning: ReasoningState = { kind: 'off' },
  onReasoningChange: (r: ReasoningState) => void = noop,
) {
  return render(
    <CockpitMenu
      control={control}
      reasoning={reasoning}
      onReasoningChange={onReasoningChange}
      onClose={noop}
      chatFontScale="standard"
      onChatFontScaleChange={noop}
    />,
  );
}

describe('CockpitMenu reasoning', () => {
  it('none → renders no reasoning section (the menu itself stays meaningful via Text size)', () => {
    renderMenu({ mode: 'none' });
    expect(screen.queryByText('Reasoning')).toBeNull();
    expect(screen.getByText('Text size')).toBeInTheDocument();
  });
  it('fixed-on → a single disabled lit On indicator', () => {
    renderMenu({ mode: 'fixed-on' }, { kind: 'on' });
    const on = screen.getByRole('menuitemradio', { name: /on/i });
    expect(on).toBeDisabled();
    expect(on.getAttribute('data-active')).toBe('true');
  });
  it('toggle → On/Off chips', () => {
    renderMenu({ mode: 'toggle', defaultOn: true });
    expect(screen.getByRole('menuitemradio', { name: /^on$/i })).toBeEnabled();
    expect(screen.getByRole('menuitemradio', { name: /^off$/i })).toBeEnabled();
  });
  it('steps → one chip per step plus Off', () => {
    renderMenu({
      mode: 'steps',
      steps: ['low', 'medium', 'high'],
      offStep: 'off',
      defaultStep: 'medium',
    });
    for (const s of ['low', 'medium', 'high']) {
      expect(
        screen.getByRole('menuitemradio', { name: new RegExp(`^${s}$`, 'i') }),
      ).toBeInTheDocument();
    }
    expect(screen.getByRole('menuitemradio', { name: /^off$/i })).toBeInTheDocument();
  });
  // Disabled over hidden (CLAUDE.md §11): a model that cannot stop reasoning
  // still shows the Off rung, greyed out and saying why. Dropping it made the
  // row silently change shape as the user moved between models.
  it('steps with offStep null → a disabled Off chip explaining itself', () => {
    renderMenu({
      mode: 'steps',
      steps: ['low', 'medium', 'high'],
      offStep: null,
      defaultStep: 'medium',
    });
    const off = screen.getByRole('menuitemradio', { name: /^off$/i });
    expect(off).toBeDisabled();
    expect(off).toHaveAttribute('title', 'This model cannot turn reasoning off');
  });

  it('fixed-on → the lit On chip says why it cannot be changed', () => {
    renderMenu({ mode: 'fixed-on' });
    const on = screen.getByRole('menuitemradio', { name: /^on$/i });
    expect(on).toBeDisabled();
    expect(on).toHaveAttribute('title', 'This model always reasons');
  });
});

describe('CockpitMenu reasoning — interaction', () => {
  it('toggle On click fires onReasoningChange({ kind: "on" })', () => {
    const onChange = vi.fn();
    renderMenu({ mode: 'toggle', defaultOn: false }, { kind: 'off' }, onChange);
    fireEvent.click(screen.getByRole('menuitemradio', { name: /^on$/i }));
    expect(onChange).toHaveBeenCalledWith({ kind: 'on' });
  });
  it('toggle Off click fires onReasoningChange({ kind: "off" })', () => {
    const onChange = vi.fn();
    renderMenu({ mode: 'toggle', defaultOn: true }, { kind: 'on' }, onChange);
    fireEvent.click(screen.getByRole('menuitemradio', { name: /^off$/i }));
    expect(onChange).toHaveBeenCalledWith({ kind: 'off' });
  });
  it('steps bucket click fires onReasoningChange({ kind: "step", step })', () => {
    const onChange = vi.fn();
    renderMenu(
      { mode: 'steps', steps: ['low', 'medium', 'high'], offStep: 'off', defaultStep: 'medium' },
      { kind: 'step', step: 'medium' },
      onChange,
    );
    fireEvent.click(screen.getByRole('menuitemradio', { name: /^high$/i }));
    expect(onChange).toHaveBeenCalledWith({ kind: 'step', step: 'high' });
  });
  it('steps Off click fires onReasoningChange({ kind: "off" })', () => {
    const onChange = vi.fn();
    renderMenu(
      { mode: 'steps', steps: ['low', 'medium', 'high'], offStep: 'off', defaultStep: 'medium' },
      { kind: 'step', step: 'medium' },
      onChange,
    );
    fireEvent.click(screen.getByRole('menuitemradio', { name: /^off$/i }));
    expect(onChange).toHaveBeenCalledWith({ kind: 'off' });
  });
  it('fixed-on On chip is non-interactive (no handler fires)', () => {
    const onChange = vi.fn();
    renderMenu({ mode: 'fixed-on' }, { kind: 'on' }, onChange);
    fireEvent.click(screen.getByRole('menuitemradio', { name: /^on$/i }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
