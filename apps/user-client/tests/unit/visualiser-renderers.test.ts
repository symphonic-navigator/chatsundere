// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import {
  type BarGeometry,
  type RenderOpts,
  type VisualiserStyle,
  drawVisualiserFrame,
} from '../../src/lib/voice/visualiser-renderers.js';

function stubCtx(): CanvasRenderingContext2D {
  const grd = { addColorStop: vi.fn() };
  return {
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    beginPath: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    createLinearGradient: vi.fn(() => grd),
    createRadialGradient: vi.fn(() => grd),
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    shadowColor: '',
    shadowBlur: 0,
  } as unknown as CanvasRenderingContext2D;
}

const OPTS: RenderOpts = {
  rgb: [140, 118, 215],
  rgbLight: [180, 158, 255],
  opacity: 0.5,
  maxHeightFraction: 0.36,
};
const GEO: BarGeometry = {
  chatview: { x: 0, y: 0, w: 400, h: 800 },
  textColumn: { x: 20, y: 0, w: 360, h: 800 },
};

describe('drawVisualiserFrame', () => {
  it.each<VisualiserStyle>(['sharp', 'soft', 'glow'])(
    'renders style %s without throwing',
    (style) => {
      const ctx = stubCtx();
      const bins = new Float32Array([0.1, 0.5, 0.9, 0.3, 0.7]);
      expect(() => drawVisualiserFrame(style, ctx, 800, bins, OPTS, GEO)).not.toThrow();
      expect(ctx.fillRect as ReturnType<typeof vi.fn>).toHaveBeenCalled();
    },
  );
});
