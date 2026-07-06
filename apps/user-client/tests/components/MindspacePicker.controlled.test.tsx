// SPDX-License-Identifier: AGPL-3.0-only

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MindspaceRow } from '../../src/boot/client-data-db.js';
import { MindspacePicker } from '../../src/components/MindspacePicker.js';

function ms(id: string, name: string, accent: string): MindspaceRow {
  return {
    id,
    displayName: name,
    palette: {
      bg: '#000',
      surfaceBase: 'rgba(0,0,0,0.1)',
      surfaceRaised: 'rgba(0,0,0,0.2)',
      surfaceInput: 'rgba(0,0,0,0.3)',
      accent,
      accentSubtle: 'rgba(0,0,0,0)',
      accentBorder: 'rgba(0,0,0,0)',
      accentBorderActive: 'rgba(0,0,0,0)',
      accentGlow: 'rgba(0,0,0,0)',
      text: { primary: '#fff', secondary: '#eee', muted: '#aaa', ghost: '#666' },
    },
    texture: 'cloudy',
    builtIn: true,
    createdAt: 0,
    updatedAt: 0,
  };
}

describe('MindspacePicker', () => {
  it('renders the preview with an actual MindspaceTexture matching selectedTexture', () => {
    const { container } = render(
      <MindspacePicker
        mindspaces={[ms('a', 'Aurum', '#c9a84c')]}
        selectedMindspaceId="a"
        selectedTexture="aurora"
        selectedFont="serif"
        previewName="Chris"
        onMindspaceChange={() => {}}
        onTextureChange={() => {}}
        onFontChange={() => {}}
      />,
    );
    const texturePreview = container.querySelector(
      '[data-mindspace-preview] [data-texture="aurora"]',
    );
    expect(texturePreview).not.toBeNull();
  });

  it('does not call onTextureChange when colour is selected', () => {
    const onColour = vi.fn();
    const onTexture = vi.fn();
    render(
      <MindspacePicker
        mindspaces={[ms('a', 'Aurum', '#c9a84c'), ms('b', 'Verdan', '#6aa97a')]}
        selectedMindspaceId="a"
        selectedTexture="aurora"
        selectedFont="serif"
        previewName="Chris"
        onMindspaceChange={onColour}
        onTextureChange={onTexture}
        onFontChange={() => {}}
      />,
    );
    fireEvent.click(screen.getByLabelText(/Mindspace Verdan/));
    expect(onColour).toHaveBeenCalledWith('b');
    expect(onTexture).not.toHaveBeenCalled();
  });

  it('omits the Font row when hideFont is true', () => {
    render(
      <MindspacePicker
        mindspaces={[ms('a', 'Aurum', '#c9a84c')]}
        selectedMindspaceId="a"
        selectedTexture="cloudy"
        previewName="Chris"
        onMindspaceChange={() => {}}
        onTextureChange={() => {}}
        hideFont
      />,
    );
    expect(screen.queryByText(/^font$/i)).toBeNull();
  });
});
