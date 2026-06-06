// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FormatPicker } from '../../src/components/lightbox/FormatPicker';

describe('FormatPicker', () => {
  it('shows the current format and offers the alternatives', () => {
    render(<FormatPicker value="code" onChange={() => {}} />);
    expect(screen.getByRole('button', { name: /format/i }).textContent).toMatch(/code/i);
    fireEvent.click(screen.getByRole('button', { name: /format/i }));
    expect(screen.getByText('Markdown')).toBeTruthy();
  });
  it('calls onChange with the picked format and closes', () => {
    const onChange = vi.fn();
    render(<FormatPicker value="plain" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /format/i }));
    fireEvent.click(screen.getByText('HTML'));
    expect(onChange).toHaveBeenCalledWith('html');
  });
});
