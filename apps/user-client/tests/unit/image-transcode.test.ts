// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { shouldTranscode, transcodeGeneratedImage } from '../../src/attachments/image-transcode.js';

describe('shouldTranscode', () => {
  it('only PNG is transcoded', () => {
    expect(shouldTranscode('image/png')).toBe(true);
    expect(shouldTranscode('IMAGE/PNG')).toBe(true);
    expect(shouldTranscode('image/png; charset=binary')).toBe(true);
    expect(shouldTranscode('image/jpeg')).toBe(false);
    expect(shouldTranscode('image/webp')).toBe(false);
    expect(shouldTranscode('application/octet-stream')).toBe(false);
  });
});

describe('transcodeGeneratedImage', () => {
  it('sends a PNG through the encoder and returns a JPEG', async () => {
    const png = new Blob([new Uint8Array(10)], { type: 'image/png' });
    const jpeg = new Blob([new Uint8Array(3)], { type: 'image/jpeg' });
    const encode = vi.fn(async () => jpeg);
    const out = await transcodeGeneratedImage({ bytes: png, mime: 'image/png' }, encode);
    expect(encode).toHaveBeenCalledWith(png);
    expect(out).toEqual({ bytes: jpeg, mime: 'image/jpeg' });
  });

  it('passes a JPEG through untouched without calling the encoder', async () => {
    const jpeg = new Blob([new Uint8Array(3)], { type: 'image/jpeg' });
    const encode = vi.fn(async () => jpeg);
    const item = { bytes: jpeg, mime: 'image/jpeg' };
    expect(await transcodeGeneratedImage(item, encode)).toBe(item);
    expect(encode).not.toHaveBeenCalled();
  });

  it('keeps the original PNG when the encoder fails', async () => {
    const png = new Blob([new Uint8Array(10)], { type: 'image/png' });
    const item = { bytes: png, mime: 'image/png' };
    const out = await transcodeGeneratedImage(item, async () => {
      throw new Error('out of memory');
    });
    expect(out).toBe(item);
  });

  it('keeps the original PNG when OffscreenCanvas is missing (default encoder)', async () => {
    // jsdom has neither createImageBitmap nor OffscreenCanvas, so the real
    // encoder throws — the fallback must still return the original.
    const png = new Blob([new Uint8Array(10)], { type: 'image/png' });
    const item = { bytes: png, mime: 'image/png' };
    expect(await transcodeGeneratedImage(item)).toBe(item);
  });
});
