// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MindspaceRow } from '../../src/boot/client-data-db.js';
import { MindspacePickerOverlay } from '../../src/components/MindspacePickerOverlay.js';

const PALETTE = {
  bg: '#000',
  surfaceBase: '#111',
  surfaceRaised: '#222',
  surfaceInput: '#333',
  accent: '#f0f',
  accentSubtle: '#a0a',
  accentBorder: '#909',
  accentBorderActive: '#b0b',
  accentGlow: '#c0c',
  text: { primary: '#fff', secondary: '#ccc', muted: '#999', ghost: '#666' },
};
const MINDSPACES: MindspaceRow[] = [
  {
    id: 'm1',
    displayName: 'Aurora',
    palette: PALETTE,
    texture: 'aurora',
    builtIn: true,
    createdAt: 0,
  },
  {
    id: 'm2',
    displayName: 'Grain',
    palette: { ...PALETTE, accent: '#0ff' },
    texture: 'grain',
    builtIn: true,
    createdAt: 0,
  },
];

function setup(over: Partial<React.ComponentProps<typeof MindspacePickerOverlay>> = {}) {
  const onSave = vi.fn();
  const onClose = vi.fn();
  const result = render(
    <MindspacePickerOverlay
      open
      onClose={onClose}
      mindspaces={MINDSPACES}
      previewName="Fable"
      initial={{ mindspaceId: 'm1', texture: 'aurora', font: 'serif' }}
      onSave={onSave}
      {...over}
    />,
  );
  return { onSave, onClose, rerender: result.rerender };
}

describe('MindspacePickerOverlay', () => {
  it('Save is disabled until a staged change, then commits the staged selection', () => {
    const { onSave } = setup();
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Mindspace Grain' }));
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    expect(onSave).toHaveBeenCalledWith({ mindspaceId: 'm2', texture: 'aurora', font: 'serif' });
  });

  it('a dirty back raises the discard guard and does not commit', () => {
    const { onSave, onClose } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Mindspace Grain' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('Discard changes?')).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('a new `initial` object with identical values does not clobber a staged change', () => {
    // Make a staged edit (Grain), then re-render with a fresh `initial` identity
    // whose *values* are the same as the original — the draft must survive.
    const { onSave, rerender } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Mindspace Grain' }));
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();

    // Fresh object reference, same values as the initial passed to setup().
    const sameValueNewIdentity = {
      mindspaceId: 'm1',
      texture: 'aurora' as const,
      font: 'serif' as const,
    };
    rerender(
      <MindspacePickerOverlay
        open
        onClose={vi.fn()}
        mindspaces={MINDSPACES}
        previewName="Fable"
        initial={sameValueNewIdentity}
        onSave={onSave}
      />,
    );

    // Save should still be enabled — staged Grain selection was not clobbered.
    expect(screen.getByRole('button', { name: 'Save' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith({ mindspaceId: 'm2', texture: 'aurora', font: 'serif' });
  });
});
