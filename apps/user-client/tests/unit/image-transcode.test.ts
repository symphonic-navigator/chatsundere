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

  const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0];

  it('transcodes PNG bytes even when the declared mime is binary/octet-stream', async () => {
    const png = new Blob([new Uint8Array(PNG_HEAD)], { type: 'binary/octet-stream' });
    const jpeg = new Blob([new Uint8Array(3)], { type: 'image/jpeg' });
    const encode = vi.fn(async () => jpeg);
    const out = await transcodeGeneratedImage({ bytes: png, mime: 'binary/octet-stream' }, encode);
    expect(encode).toHaveBeenCalledWith(png);
    expect(out).toEqual({ bytes: jpeg, mime: 'image/jpeg' });
  });

  it('labels sniffed PNG bytes image/png when the encoder fails', async () => {
    const png = new Blob([new Uint8Array(PNG_HEAD)], { type: 'binary/octet-stream' });
    const out = await transcodeGeneratedImage(
      { bytes: png, mime: 'binary/octet-stream' },
      async () => {
        throw new Error('boom');
      },
    );
    expect(out).toEqual({ bytes: png, mime: 'image/png' });
  });

  it('leaves JPEG bytes alone whatever the declared mime', async () => {
    const jpegBytes = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0])]);
    const encode = vi.fn(async () => jpegBytes);
    const item = { bytes: jpegBytes, mime: 'binary/octet-stream' };
    expect(await transcodeGeneratedImage(item, encode)).toBe(item);
    expect(encode).not.toHaveBeenCalled();
  });

  it('keeps the original when the encoder does not return a JPEG', async () => {
    const png = new Blob([new Uint8Array(10)], { type: 'image/png' });
    const item = { bytes: png, mime: 'image/png' };
    const out = await transcodeGeneratedImage(
      item,
      async () => new Blob([new Uint8Array(2)], { type: 'image/png' }),
    );
    expect(out).toBe(item);
  });
});
