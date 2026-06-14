// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it, vi } from 'vitest';
import { AudioSink } from '../../src/lib/voice/audio-sink.js';

describe('AudioSink.getAnalyser', () => {
  it('returns null before any AudioContext exists', () => {
    const sink = new AudioSink();
    expect(sink.getAnalyser()).toBeNull();
  });

  it('exposes the analyser once the context is created', () => {
    const analyser = {
      fftSize: 0,
      frequencyBinCount: 128,
      connect: vi.fn(),
      getByteFrequencyData: vi.fn(),
    };
    const ctxStub = {
      state: 'running',
      createAnalyser: vi.fn(() => analyser),
      destination: {},
      resume: vi.fn(),
      suspend: vi.fn(),
      close: vi.fn(),
    };
    vi.stubGlobal(
      'AudioContext',
      vi.fn(() => ctxStub),
    );

    const sink = new AudioSink();
    sink.ensureAnalyserForTest();
    expect(sink.getAnalyser()).toBe(analyser);
    expect(analyser.connect).toHaveBeenCalledWith(ctxStub.destination);
    vi.unstubAllGlobals();
  });
});
