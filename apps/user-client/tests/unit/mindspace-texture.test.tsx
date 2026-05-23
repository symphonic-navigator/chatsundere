// SPDX-License-Identifier: AGPL-3.0-only

import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MindspaceTexture } from '../../src/components/MindspaceTexture.js';

describe('MindspaceTexture', () => {
  it('renders the cloudy variant with two radial-gradient layers', () => {
    const { container } = render(<MindspaceTexture texture="cloudy" accent="#c9a84c" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root).not.toBeNull();
    expect(root.getAttribute('data-texture')).toBe('cloudy');
    // Cloudy renders two child <div> overlays (the two ellipses).
    expect(root.querySelectorAll('[data-cloudy-layer]').length).toBe(2);
  });

  it('renders the aurora variant with three drifting layers', () => {
    const { container } = render(<MindspaceTexture texture="aurora" accent="#7c9ede" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.getAttribute('data-texture')).toBe('aurora');
    expect(root.querySelectorAll('[data-aurora-layer]').length).toBe(3);
  });

  it('renders the grain variant with a single static noise layer', () => {
    const { container } = render(<MindspaceTexture texture="grain" accent="#74c69d" />);
    const root = container.firstElementChild as HTMLElement;
    expect(root.getAttribute('data-texture')).toBe('grain');
    expect(root.querySelectorAll('[data-grain-layer]').length).toBe(1);
  });

  it('passes the accent through to inline styles for the cloudy variant', () => {
    const { container } = render(<MindspaceTexture texture="cloudy" accent="#c9a84c" />);
    const layers = container.querySelectorAll<HTMLElement>('[data-cloudy-layer]');
    expect(layers[0]?.style.background).toContain('201, 168, 76');
  });
});
