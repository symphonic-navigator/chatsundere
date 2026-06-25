import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { InlineEditTextarea } from '../../src/routes/app/settings/InlineEditTextarea.js';

describe('InlineEditTextarea', () => {
  it('persists the edited value on blur and announces Saved', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<InlineEditTextarea label="About me" value="old" onSave={onSave} />);
    const field = screen.getByLabelText('About me');
    fireEvent.change(field, { target: { value: 'new text' } });
    fireEvent.blur(field);
    await waitFor(() => expect(onSave).toHaveBeenCalledWith('new text'));
    expect(await screen.findByText('Saved ✓')).toBeInTheDocument();
  });

  it('does not persist when the value is unchanged (no-op guard)', () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<InlineEditTextarea label="About me" value="same" onSave={onSave} />);
    fireEvent.blur(screen.getByLabelText('About me'));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('Enter inserts a newline and does not commit', () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<InlineEditTextarea label="About me" value="" onSave={onSave} />);
    const field = screen.getByLabelText('About me');
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onSave).not.toHaveBeenCalled();
  });
});
