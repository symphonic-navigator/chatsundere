// SPDX-License-Identifier: AGPL-3.0-only

import type { CSSProperties } from 'react';

interface Props {
  texture: 'cloudy' | 'aurora' | 'grain';
  accent: string;
}

/**
 * Renders the mindspace texture overlay. Three variants per Spec § 5.2:
 *  - cloudy:  two soft radial-gradient ellipses with float1/float2 keyframes
 *  - aurora:  three layered hue-shifting gradients with slow drift
 *  - grain:   single static inline-SVG noise pattern
 *
 * All variants respect `prefers-reduced-motion` via global CSS in
 * `index.css` (`.mindspace-texture *` selectors disable animations).
 */
export function MindspaceTexture({ texture, accent }: Props): JSX.Element {
  const rgb = hexToRgbTriplet(accent);
  const wrapStyle: CSSProperties = {
    position: 'absolute',
    inset: 0,
    pointerEvents: 'none',
    overflow: 'hidden',
    zIndex: 0,
  };

  if (texture === 'cloudy') {
    const a: CSSProperties = {
      position: 'absolute',
      top: '-10%',
      left: '-20%',
      width: '80%',
      height: '60%',
      background: `radial-gradient(ellipse, rgba(${rgb}, 0.08) 0%, transparent 70%)`,
      animation: 'mindspace-float1 30s ease-in-out infinite',
    };
    const b: CSSProperties = {
      position: 'absolute',
      bottom: '10%',
      right: '-20%',
      width: '70%',
      height: '50%',
      background: `radial-gradient(ellipse, rgba(${rgb}, 0.05) 0%, transparent 65%)`,
      animation: 'mindspace-float2 40s ease-in-out infinite',
    };
    return (
      <div className="mindspace-texture" data-texture="cloudy" style={wrapStyle}>
        <div data-cloudy-layer style={a} />
        <div data-cloudy-layer style={b} />
      </div>
    );
  }

  if (texture === 'aurora') {
    const layer = (i: 0 | 1 | 2): CSSProperties => ({
      position: 'absolute',
      inset: '-20%',
      background: `radial-gradient(ellipse at ${30 + i * 25}% ${20 + i * 30}%,
        rgba(${rgb}, ${0.07 - i * 0.015}) 0%, transparent 60%)`,
      animation: `mindspace-aurora${i + 1} ${50 + i * 10}s ease-in-out infinite`,
      mixBlendMode: 'screen',
    });
    return (
      <div className="mindspace-texture" data-texture="aurora" style={wrapStyle}>
        <div data-aurora-layer style={layer(0)} />
        <div data-aurora-layer style={layer(1)} />
        <div data-aurora-layer style={layer(2)} />
      </div>
    );
  }

  // grain
  const noise = `data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 200 200'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/></filter><rect width='100%' height='100%' filter='url(%23n)' opacity='0.08'/></svg>`;
  return (
    <div className="mindspace-texture" data-texture="grain" style={wrapStyle}>
      <div
        data-grain-layer
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: `url("${noise}")`,
          backgroundRepeat: 'repeat',
        }}
      />
    </div>
  );
}

function hexToRgbTriplet(hex: string): string {
  const v = hex.replace('#', '');
  const r = Number.parseInt(v.slice(0, 2), 16);
  const g = Number.parseInt(v.slice(2, 4), 16);
  const b = Number.parseInt(v.slice(4, 6), 16);
  return `${r}, ${g}, ${b}`;
}
