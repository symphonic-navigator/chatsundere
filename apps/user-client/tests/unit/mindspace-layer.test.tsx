// SPDX-License-Identifier: AGPL-3.0-only

import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MindspaceLayer } from '../../src/components/MindspaceLayer.js';
import { useMindspaceStore } from '../../src/state/mindspace.store.js';

describe('MindspaceLayer', () => {
  beforeEach(() => {
    useMindspaceStore.getState().reset();
  });
  afterEach(() => {
    // Clean up any properties the component set.
    for (const p of [
      '--mindspace-bg',
      '--mindspace-accent',
      '--mindspace-text-primary',
      '--mindspace-text-muted',
    ]) {
      document.documentElement.style.removeProperty(p);
    }
  });

  it('writes resolved palette as CSS custom properties on documentElement', () => {
    useMindspaceStore.getState().update({
      persona: null,
      defaultMindspaceId: 'aurum',
      mindspaces: [
        {
          id: 'aurum',
          displayName: 'Aurum',
          palette: {
            bg: '#0a0a0a',
            surfaceBase: 'rgba(255,255,255,0.025)',
            surfaceRaised: 'rgba(255,255,255,0.04)',
            surfaceInput: 'rgba(0,0,0,0.3)',
            accent: '#c9a84c',
            accentSubtle: 'rgba(201,168,76,0.06)',
            accentBorder: 'rgba(201,168,76,0.15)',
            accentBorderActive: 'rgba(201,168,76,0.35)',
            accentGlow: 'rgba(201,168,76,0.08)',
            text: {
              primary: '#f0e8d8',
              secondary: '#e8e0d0',
              muted: 'rgba(232,224,208,0.4)',
              ghost: 'rgba(232,224,208,0.2)',
            },
          },
          texture: 'cloudy',
          builtIn: true,
          createdAt: 0,
        },
      ],
    });
    render(<MindspaceLayer />);
    expect(document.documentElement.style.getPropertyValue('--mindspace-bg')).toBe('#0a0a0a');
    expect(document.documentElement.style.getPropertyValue('--mindspace-accent')).toBe('#c9a84c');
    expect(document.documentElement.style.getPropertyValue('--mindspace-text-primary')).toBe(
      '#f0e8d8',
    );
  });

  it('renders nothing when resolved is null', () => {
    const { container } = render(<MindspaceLayer />);
    expect(container.firstChild).toBeNull();
  });
});
