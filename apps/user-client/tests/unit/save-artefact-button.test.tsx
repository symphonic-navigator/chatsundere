// SPDX-License-Identifier: AGPL-3.0-only
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { SaveArtefactButton } from '../../src/components/chat/markdown/SaveArtefactButton.js';

test('calls onSave and stops propagation', () => {
  const onSave = vi.fn();
  const onParentClick = vi.fn();
  render(
    // biome-ignore lint/a11y/useKeyWithClickEvents: test-only wrapper
    <div onClick={onParentClick}>
      <SaveArtefactButton onSave={onSave} />
    </div>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  expect(onSave).toHaveBeenCalledOnce();
  expect(onParentClick).not.toHaveBeenCalled();
});
