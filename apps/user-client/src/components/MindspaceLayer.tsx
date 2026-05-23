// SPDX-License-Identifier: AGPL-3.0-only

import { useEffect } from 'react';
import { useMindspaceStore } from '../state/mindspace.store.js';
import { MindspaceTexture } from './MindspaceTexture.js';

/**
 * Mounts at the application root. Subscribes to the mindspace store and
 * writes the resolved palette to `document.documentElement.style` as CSS
 * custom properties. Renders the texture overlay below the UI.
 */
export function MindspaceLayer(): JSX.Element | null {
  const resolved = useMindspaceStore((s) => s.resolved);

  useEffect(() => {
    if (!resolved) return;
    const root = document.documentElement;
    const p = resolved.palette;
    root.style.setProperty('--mindspace-bg', p.bg);
    root.style.setProperty('--mindspace-surface-base', p.surfaceBase);
    root.style.setProperty('--mindspace-surface-raised', p.surfaceRaised);
    root.style.setProperty('--mindspace-surface-input', p.surfaceInput);
    root.style.setProperty('--mindspace-accent', p.accent);
    root.style.setProperty('--mindspace-accent-subtle', p.accentSubtle);
    root.style.setProperty('--mindspace-accent-border', p.accentBorder);
    root.style.setProperty('--mindspace-accent-border-active', p.accentBorderActive);
    root.style.setProperty('--mindspace-accent-glow', p.accentGlow);
    root.style.setProperty('--mindspace-text-primary', p.text.primary);
    root.style.setProperty('--mindspace-text-secondary', p.text.secondary);
    root.style.setProperty('--mindspace-text-muted', p.text.muted);
    root.style.setProperty('--mindspace-text-ghost', p.text.ghost);
  }, [resolved]);

  if (!resolved) return null;
  return <MindspaceTexture texture={resolved.texture} accent={resolved.palette.accent} />;
}
