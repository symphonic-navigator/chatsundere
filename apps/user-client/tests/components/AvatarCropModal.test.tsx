// SPDX-License-Identifier: AGPL-3.0-only

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AvatarCropModal } from '../../src/components/AvatarCropModal.js';

describe('AvatarCropModal', () => {
  it('emits the current crop on confirm', () => {
    const onConfirm = vi.fn();
    render(
      <AvatarCropModal
        imageUrl="blob:fake"
        naturalWidth={400}
        naturalHeight={400}
        initialCrop={{ x: 0, y: 0, zoom: 1 }}
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );
    const zoom = screen.getByRole('slider', { name: /zoom/i });
    fireEvent.change(zoom, { target: { value: '1.5' } });
    screen.getByRole('button', { name: /save/i }).click();
    expect(onConfirm).toHaveBeenCalledWith({ x: 0, y: 0, zoom: 1.5 });
  });
});
