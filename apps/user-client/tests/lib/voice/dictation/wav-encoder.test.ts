// SPDX-License-Identifier: AGPL-3.0-only
// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { float32ToWavBlob } from '../../../../src/lib/voice/dictation/wav-encoder.js';

describe('float32ToWavBlob', () => {
  it('produces a RIFF/WAVE header with correct sizes', async () => {
    const blob = float32ToWavBlob(new Float32Array(16_000), 16_000); // 1 s silence
    expect(blob.type).toBe('audio/wav');
    expect(blob.size).toBe(44 + 16_000 * 2);
    const head = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
    expect(String.fromCharCode(...head.slice(0, 4))).toBe('RIFF');
    expect(String.fromCharCode(...head.slice(8, 12))).toBe('WAVE');
  });

  it('clamps out-of-range samples instead of overflowing', async () => {
    const blob = float32ToWavBlob(new Float32Array([2, -2]), 16_000);
    const data = new DataView(await blob.slice(44).arrayBuffer());
    expect(data.getInt16(0, true)).toBe(0x7fff);
    expect(data.getInt16(2, true)).toBe(-0x8000);
  });
});
