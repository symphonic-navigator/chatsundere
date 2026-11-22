// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { sniffAgrees, sniffMediaMime } from '../../../src/lib/media/media-sniff.js';

function bytes(...parts: (string | number[])[]): Uint8Array {
  const out: number[] = [];
  for (const p of parts) {
    if (typeof p === 'string') for (const ch of p) out.push(ch.charCodeAt(0));
    else out.push(...p);
  }
  return new Uint8Array(out);
}

describe('sniffMediaMime', () => {
  it('recognises an ID3 tag as MPEG audio', () => {
    expect(sniffMediaMime(bytes('ID3', [4, 0, 0, 0, 0, 0, 0]))).toBe('audio/mpeg');
  });

  it('recognises a bare MPEG audio frame header', () => {
    expect(sniffMediaMime(bytes([0xff, 0xfb, 0x90, 0x64]))).toBe('audio/mpeg');
  });

  it('recognises Ogg', () => {
    expect(sniffMediaMime(bytes('OggS', [0, 2, 0, 0]))).toBe('audio/ogg');
  });

  it('recognises RIFF WAVE', () => {
    expect(sniffMediaMime(bytes('RIFF', [0x24, 0, 0, 0], 'WAVEfmt '))).toBe('audio/wav');
  });

  it('does not take any RIFF container for WAVE', () => {
    expect(sniffMediaMime(bytes('RIFF', [0x24, 0, 0, 0], 'AVI LIST'))).toBeNull();
  });

  it('recognises FLAC', () => {
    expect(sniffMediaMime(bytes('fLaC', [0, 0, 0, 0x22]))).toBe('audio/flac');
  });

  it('recognises an ftyp box as MP4 video', () => {
    expect(sniffMediaMime(bytes([0, 0, 0, 0x20], 'ftypisom', [0, 0, 2, 0]))).toBe('video/mp4');
  });

  it("recognises the 'M4A ' brand as MP4 audio", () => {
    expect(sniffMediaMime(bytes([0, 0, 0, 0x20], 'ftypM4A ', [0, 0, 0, 0]))).toBe('audio/mp4');
  });

  it("recognises the 'qt' brand as QuickTime", () => {
    expect(sniffMediaMime(bytes([0, 0, 0, 0x14], 'ftypqt  ', [0, 0, 0, 0]))).toBe(
      'video/quicktime',
    );
  });

  it('recognises the EBML magic as WebM', () => {
    expect(sniffMediaMime(bytes([0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42]))).toBe('video/webm');
  });

  it('returns null for HTML', () => {
    expect(sniffMediaMime(new TextEncoder().encode('<!doctype html>'))).toBeNull();
  });

  it('returns null for too few bytes', () => {
    expect(sniffMediaMime(new Uint8Array([0xff]))).toBeNull();
  });
});

describe('sniffAgrees', () => {
  it('refuses an unrecognised body', () => {
    expect(sniffAgrees('audio/mpeg', null)).toBe(false);
  });

  it('accepts the same top-level type', () => {
    expect(sniffAgrees('audio/opus', 'audio/ogg')).toBe(true);
    expect(sniffAgrees('audio/mpeg', 'audio/mpeg')).toBe(true);
  });

  it('treats WebM audio and video as interchangeable', () => {
    expect(sniffAgrees('audio/webm', 'video/webm')).toBe(true);
  });

  it('treats MP4 audio and video as interchangeable', () => {
    expect(sniffAgrees('audio/mp4', 'video/mp4')).toBe(true);
    expect(sniffAgrees('video/mp4', 'audio/mp4')).toBe(true);
  });

  it('refuses a cross-type mismatch', () => {
    expect(sniffAgrees('video/mp4', 'audio/mpeg')).toBe(false);
    expect(sniffAgrees('audio/mpeg', 'video/webm')).toBe(false);
  });
});
