// SPDX-License-Identifier: AGPL-3.0-only

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MindspaceRow } from '../../src/boot/client-data-db.js';
import { MindspacePicker } from '../../src/components/MindspacePicker.js';

const ms = (id: string, name: string, accent: string): MindspaceRow => ({
  id,
  displayName: name,
  palette: {
    bg: '#000',
    surfaceBase: 'rgba(0,0,0,0)',
    surfaceRaised: 'rgba(0,0,0,0)',
    surfaceInput: 'rgba(0,0,0,0)',
    accent,
    accentSubtle: 'rgba(0,0,0,0)',
    accentBorder: 'rgba(0,0,0,0)',
    accentBorderActive: 'rgba(0,0,0,0)',
    accentGlow: 'rgba(0,0,0,0)',
    text: { primary: '#fff', secondary: '#fff', muted: '#fff', ghost: '#fff' },
  },
  texture: 'cloudy',
  builtIn: true,
  createdAt: 0,
  updatedAt: 0,
});

const sevenMindspaces: MindspaceRow[] = [
  ms('crimson', 'Crimson', '#b33a5e'),
  ms('aurum', 'Aurum', '#c9a84c'),
  ms('verdan', 'Verdan', '#6aa97a'),
  ms('azuro', 'Azuro', '#4a7eb3'),
  ms('indigaut', 'Indigaut', '#5d4e9e'),
  ms('violetta', 'Violetta', '#9a5bb8'),
  ms('rosari', 'Rosari', '#c97a99'),
];

describe('MindspacePicker', () => {
  it('renders seven colour swatches', () => {
    render(
      <MindspacePicker
        mindspaces={sevenMindspaces}
        selectedMindspaceId="aurum"
        selectedTexture="cloudy"
        selectedFont="serif"
        previewName="Chris"
        onMindspaceChange={() => {}}
        onTextureChange={() => {}}
        onFontChange={() => {}}
      />,
    );
    expect(screen.getAllByRole('button', { name: /mindspace/i }).length).toBe(7);
  });

  it('fires onMindspaceChange when a swatch is clicked', () => {
    const onMs = vi.fn();
    render(
      <MindspacePicker
        mindspaces={sevenMindspaces}
        selectedMindspaceId="aurum"
        selectedTexture="cloudy"
        selectedFont="serif"
        previewName="Chris"
        onMindspaceChange={onMs}
        onTextureChange={() => {}}
        onFontChange={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /verdan/i }));
    expect(onMs).toHaveBeenCalledWith('verdan');
  });

  it('shows "Use user default" chip when allowUserDefault is true', () => {
    render(
      <MindspacePicker
        mindspaces={sevenMindspaces}
        selectedMindspaceId={null}
        selectedTexture="cloudy"
        selectedFont="serif"
        previewName="Aurum"
        allowUserDefault
        onMindspaceChange={() => {}}
        onTextureChange={() => {}}
        onFontChange={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: /use user default/i })).toBeInTheDocument();
  });

  it('renders the preview name in the selected font', () => {
    render(
      <MindspacePicker
        mindspaces={sevenMindspaces}
        selectedMindspaceId="aurum"
        selectedTexture="cloudy"
        selectedFont="cursive"
        previewName="Chris"
        onMindspaceChange={() => {}}
        onTextureChange={() => {}}
        onFontChange={() => {}}
      />,
    );
    const preview = screen.getByText('Chris');
    expect(preview.className).toMatch(/font-cursive|italic/);
  });
});
