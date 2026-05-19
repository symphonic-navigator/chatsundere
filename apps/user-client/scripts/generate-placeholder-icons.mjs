/**
 * Generates placeholder PWA icons for Chatsundere.
 *
 * Outputs four files into public/icons/:
 *   icon-192.png           192×192   standard icon
 *   icon-512.png           512×512   standard large icon
 *   icon-maskable-512.png  512×512   maskable (80 % safe-area padding)
 *   apple-touch-icon.png   180×180   iOS home screen
 *
 * Colour palette matches the aurora tokens:
 *   aurora-700  #432db8
 *   aurora-900  #160a3d
 *
 * Re-run before v0.1.0 once real artwork is available.
 * These placeholder outputs are committed as binary assets.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createCanvas } from '@napi-rs/canvas';

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(__dirname, '../public/icons');
mkdirSync(outDir, { recursive: true });

/** Aurora gradient stop colours (hex). */
const AURORA_700 = '#432db8';
const AURORA_900 = '#160a3d';

/**
 * Draws a single icon onto a canvas of the given size.
 *
 * @param {number} size        - Canvas side length in pixels.
 * @param {number} safeArea    - Fraction of the canvas to use for content
 *                               (1.0 = full canvas, 0.8 = maskable safe area).
 * @returns {import('@napi-rs/canvas').Canvas}
 */
function drawIcon(size, safeArea = 1.0) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  // --- Background gradient (full canvas always, so the mask crop looks solid) ---
  const bg = ctx.createLinearGradient(0, 0, size, size);
  bg.addColorStop(0, AURORA_700);
  bg.addColorStop(1, AURORA_900);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);

  // --- Subtle radial shimmer centred at top-left third ---
  const shimmer = ctx.createRadialGradient(
    size * 0.3,
    size * 0.3,
    0,
    size * 0.3,
    size * 0.3,
    size * 0.7,
  );
  shimmer.addColorStop(0, 'rgba(255,255,255,0.12)');
  shimmer.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = shimmer;
  ctx.fillRect(0, 0, size, size);

  // --- Monogram "C" ---
  const contentSize = size * safeArea;
  const offset = (size - contentSize) / 2;
  const cx = offset + contentSize / 2;
  const cy = offset + contentSize / 2;

  // Font size is ~55 % of the content area so it reads clearly at small sizes.
  const fontSize = Math.round(contentSize * 0.55);
  ctx.font = `italic ${fontSize}px 'Instrument Serif', Georgia, serif`;
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('C', cx, cy);

  return canvas;
}

/** Writes a canvas to a PNG file. */
function save(canvas, filename) {
  const buffer = canvas.toBuffer('image/png');
  const outPath = join(outDir, filename);
  writeFileSync(outPath, buffer);
  console.log(`  wrote ${outPath} (${buffer.length} bytes)`);
}

console.log('Generating placeholder Chatsundere icons…');

save(drawIcon(192), 'icon-192.png');
save(drawIcon(512), 'icon-512.png');
save(drawIcon(512, 0.8), 'icon-maskable-512.png');
save(drawIcon(180), 'apple-touch-icon.png');

console.log('Done.');
