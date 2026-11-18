// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Switch } from '../../src/components/ui/Switch.js';

function Row(props: { disabled?: boolean; onChange?: (next: boolean) => void }): JSX.Element {
  const [on, setOn] = useState(false);
  return (
    <div>
      <label htmlFor="row-switch">Remember me</label>
      <Switch
        id="row-switch"
        checked={on}
        disabled={props.disabled}
        onChange={(next) => {
          props.onChange?.(next);
          setOn(next);
        }}
      />
    </div>
  );
}

describe('Switch', () => {
  it('renders as a switch with aria-checked and the hit-area class', () => {
    render(<Switch checked ariaLabel="Roleplay" onChange={() => undefined} />);
    const sw = screen.getByRole('switch', { name: 'Roleplay' });
    expect(sw).toHaveAttribute('aria-checked', 'true');
    expect(sw).toHaveAttribute('type', 'button');
    expect(sw).toHaveClass('cs-hit');
  });

  it('calls onChange with the next state on click', () => {
    const onChange = vi.fn();
    render(<Switch checked={false} ariaLabel="Roleplay" onChange={onChange} />);
    fireEvent.click(screen.getByRole('switch', { name: 'Roleplay' }));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('takes its name from labelledBy', () => {
    render(
      <>
        <span id="l">Projects (preview)</span>
        <Switch checked={false} labelledBy="l" onChange={() => undefined} />
      </>,
    );
    expect(screen.getByRole('switch', { name: 'Projects (preview)' })).toBeInTheDocument();
  });

  it('toggles when the row label is clicked', () => {
    const onChange = vi.fn();
    render(<Row onChange={onChange} />);
    fireEvent.click(screen.getByText('Remember me'));
    expect(onChange).toHaveBeenCalledWith(true);
    expect(screen.getByRole('switch', { name: 'Remember me' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  it('does nothing when disabled, by click or by label', () => {
    const onChange = vi.fn();
    render(<Row disabled onChange={onChange} />);
    const sw = screen.getByRole('switch', { name: 'Remember me' });
    expect(sw).toBeDisabled();
    fireEvent.click(sw);
    fireEvent.click(screen.getByText('Remember me'));
    expect(onChange).not.toHaveBeenCalled();
    expect(sw).toHaveAttribute('aria-checked', 'false');
  });
});
