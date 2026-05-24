// SPDX-License-Identifier: AGPL-3.0-only

import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditorTopbar } from '../../src/components/EditorTopbar.js';

describe('EditorTopbar', () => {
  beforeEach(() => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the title', () => {
    render(
      <EditorTopbar
        title="My Settings"
        isDirty={false}
        onBack={() => {}}
        onSaveAndBack={() => {}}
      />,
    );
    expect(screen.getByText('My Settings')).toBeInTheDocument();
  });

  it('back button fires onBack directly when not dirty (no confirm)', () => {
    const onBack = vi.fn();
    const confirmSpy = vi.spyOn(window, 'confirm');
    render(<EditorTopbar title="X" isDirty={false} onBack={onBack} onSaveAndBack={() => {}} />);
    fireEvent.click(screen.getByLabelText(/back/i));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('back button asks for confirmation when dirty, calls onBack only if confirmed', () => {
    const onBack = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<EditorTopbar title="X" isDirty={true} onBack={onBack} onSaveAndBack={() => {}} />);
    fireEvent.click(screen.getByLabelText(/back/i));
    expect(window.confirm).toHaveBeenCalled();
    expect(onBack).not.toHaveBeenCalled();
  });

  it('back proceeds when user confirms discard', () => {
    const onBack = vi.fn();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<EditorTopbar title="X" isDirty={true} onBack={onBack} onSaveAndBack={() => {}} />);
    fireEvent.click(screen.getByLabelText(/back/i));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('Save & Back fires onSaveAndBack when enabled', () => {
    const onSaveAndBack = vi.fn();
    render(
      <EditorTopbar title="X" isDirty={true} onBack={() => {}} onSaveAndBack={onSaveAndBack} />,
    );
    fireEvent.click(screen.getByRole('button', { name: /save & back/i }));
    expect(onSaveAndBack).toHaveBeenCalledTimes(1);
  });

  it('Save & Back is disabled when saveDisabled is true', () => {
    const onSaveAndBack = vi.fn();
    render(
      <EditorTopbar
        title="X"
        isDirty={true}
        onBack={() => {}}
        onSaveAndBack={onSaveAndBack}
        saveDisabled
      />,
    );
    const btn = screen.getByRole('button', { name: /save & back/i });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    expect(onSaveAndBack).not.toHaveBeenCalled();
  });

  it('omits the Save & Back button when hideSaveAndBack is true', () => {
    render(
      <EditorTopbar
        title="X"
        isDirty={false}
        onBack={() => {}}
        onSaveAndBack={() => {}}
        hideSaveAndBack
      />,
    );
    expect(screen.queryByRole('button', { name: /save & back/i })).toBeNull();
  });
});
