// SPDX-License-Identifier: AGPL-3.0-only
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MessageRow, PersonaRow } from '../../../src/boot/client-data-db.js';
import type { SpeechSegment } from '../../../src/lib/voice/segmentation.js';

// ---- Mocks (declared before importing the hook under test) ----

const resolveTtsMock = vi.fn((_persona: PersonaRow) => Promise.resolve(null as unknown));
vi.mock('../../../src/lib/voice/resolve-tts.js', () => ({
  resolveTts: (persona: PersonaRow) => resolveTtsMock(persona),
}));

const cacheDeleteMock = vi.fn(async (_key: string): Promise<void> => {});
vi.mock('../../../src/lib/voice/voice-cache.js', () => ({
  cacheDelete: (key: string) => cacheDeleteMock(key),
}));

// A controllable AudioSink stand-in.
const sinkPlay = vi.fn(async (_blob: Blob, _signal?: AbortSignal): Promise<void> => {});
const sinkDispose = vi.fn(async () => {});
vi.mock('../../../src/lib/voice/audio-sink.js', () => ({
  AudioSink: class {
    play = sinkPlay;
    pause = vi.fn(async () => {});
    resume = vi.fn(async () => {});
    stop = vi.fn();
    dispose = sinkDispose;
  },
}));

const settingsData: { voiceMode: 'paragraph' | 'sentence' } = { voiceMode: 'paragraph' };
vi.mock('../../../src/data/settings.js', () => ({
  useSettings: () => ({ data: settingsData }),
}));

import {
  _resetResumeMemoryForTests,
  peekPosition,
  rememberPosition,
} from '../../../src/lib/voice/resume-memory.js';
import { useVoicePlayback } from '../../../src/lib/voice/use-voice-playback.js';

const persona = {
  id: 'p1',
  roleplay: false,
  voice: 'voice-x',
} as unknown as PersonaRow;

function msg(id: string, text: string): MessageRow {
  return {
    id,
    chatId: 'c1',
    role: 'persona',
    contentBlocks: [{ type: 'text', text }],
    createdAt: 1,
    updatedAt: 1,
    bookmarked: false,
    streamingState: 'complete',
  };
}

const okResolution = {
  ok: true as const,
  fetchAudio: vi.fn(
    async (_seg: SpeechSegment, _signal: AbortSignal) => new Blob(['x'], { type: 'audio/mpeg' }),
  ),
  voiceLabel: 'Test voice',
  cacheKeyFor: (s: { segmentId: string }) => `key:${s.segmentId}`,
};

beforeEach(() => {
  settingsData.voiceMode = 'paragraph';
  _resetResumeMemoryForTests();
  resolveTtsMock.mockReset();
  cacheDeleteMock.mockClear();
  sinkPlay.mockReset();
  sinkPlay.mockResolvedValue(undefined);
  sinkDispose.mockClear();
  okResolution.fetchAudio.mockClear();
  okResolution.fetchAudio.mockResolvedValue(new Blob(['x'], { type: 'audio/mpeg' }));
});

afterEach(() => {
  _resetResumeMemoryForTests();
});

// Two paragraphs → two segments; long enough to clear the min-length gate.
const TWO_PARA =
  'This is the first paragraph that is comfortably long enough to be spoken aloud.\n\n' +
  'And here is the second paragraph, also long enough to count as a speakable segment.';

describe('useVoicePlayback', () => {
  it('playMessage drives the machine to speaking and plays the first segment', async () => {
    resolveTtsMock.mockResolvedValue(okResolution);
    // Hold play open so the machine stays in speaking.
    let releasePlay: () => void = () => {};
    sinkPlay.mockImplementation(
      () =>
        new Promise<void>((res) => {
          releasePlay = res;
        }),
    );

    const { result } = renderHook(() => useVoicePlayback('c1', persona, []));

    await act(async () => {
      await result.current.playMessage(msg('m1', TWO_PARA));
    });

    await waitFor(() => expect(result.current.transportState).toBe('speaking'));
    expect(sinkPlay).toHaveBeenCalledTimes(1);
    expect(result.current.currentSegmentId).not.toBeNull();
    act(() => releasePlay());
  });

  it('returns the not-ok reason and never plays when TTS cannot resolve', async () => {
    resolveTtsMock.mockResolvedValue({ ok: false, reason: 'no-voice' });
    const { result } = renderHook(() => useVoicePlayback('c1', persona, []));

    let reason: string | null = 'unset';
    await act(async () => {
      reason = await result.current.playMessage(msg('m1', TWO_PARA));
    });
    expect(reason).toBe('no-voice');
    expect(sinkPlay).not.toHaveBeenCalled();
  });

  it('remembers the position on unmount while non-idle (LEAVE_CHAT)', async () => {
    resolveTtsMock.mockResolvedValue(okResolution);
    sinkPlay.mockImplementation(() => new Promise<void>(() => {})); // never resolves → stays speaking

    const { result, unmount } = renderHook(() => useVoicePlayback('c1', persona, []));
    await act(async () => {
      await result.current.playMessage(msg('m1', TWO_PARA));
    });
    await waitFor(() => expect(result.current.transportState).toBe('speaking'));

    unmount();
    const pos = peekPosition('c1');
    expect(pos).not.toBeNull();
    expect(pos?.messageId).toBe('m1');
    expect(pos?.segmentIndex).toBe(0);
    // The remembered paragraph drives the resume label; segment 0 is paragraph 0.
    expect(pos?.paragraphIndex).toBe(0);
  });

  it('evicts the cache and retries once on a decode failure', async () => {
    resolveTtsMock.mockResolvedValue(okResolution);
    // First play rejects (decode failure); the retried play resolves.
    sinkPlay.mockRejectedValueOnce(new Error('decode')).mockResolvedValue(undefined);

    const { result } = renderHook(() => useVoicePlayback('c1', persona, []));
    await act(async () => {
      await result.current.playMessage(msg('m1', TWO_PARA));
    });

    await waitFor(() => expect(cacheDeleteMock).toHaveBeenCalledTimes(1));
    // The retry re-fetched the segment and played again → at least two play calls.
    await waitFor(() => expect(sinkPlay.mock.calls.length).toBeGreaterThanOrEqual(2));
    // The machine recovered rather than landing in failed.
    expect(result.current.transportState).not.toBe('failed');
  });

  it('decode failure evicts the PLAYING segment key even after a later prefetch lands (C1)', async () => {
    // Regression guard: prefetch of segment 1 must complete BEFORE segment 0's
    // play rejects, so the old shared-ref design would evict segment 1's key.
    // The fix threads the segment into play, so the eviction targets segment 0.
    resolveTtsMock.mockResolvedValue(okResolution);

    // Track which segments were fetched, in order, so we can assert the retry
    // re-fetched segment 0 (not the prefetched segment 1).
    const fetchedKeys: string[] = [];
    okResolution.fetchAudio.mockImplementation(async (s: SpeechSegment, _signal: AbortSignal) => {
      fetchedKeys.push(s.segmentId);
      return new Blob([s.segmentId], { type: 'audio/mpeg' });
    });

    // play(segment 0) hangs until we release it, then rejects (decode failure).
    // play of any other segment resolves immediately. This lets the prefetch of
    // segment 1 genuinely land first.
    let rejectSeg0: () => void = () => {};
    sinkPlay.mockImplementation(
      (_blob: Blob, _signal?: AbortSignal) =>
        new Promise<void>((_res, rej) => {
          rejectSeg0 = () => rej(new Error('decode'));
        }),
    );

    const { result } = renderHook(() => useVoicePlayback('c1', persona, []));
    await act(async () => {
      await result.current.playMessage(msg('m1', TWO_PARA));
    });

    // Let the prefetch of segment 1 land before we force the decode failure.
    await waitFor(() => expect(fetchedKeys).toContain('0:1'));
    expect(fetchedKeys).toEqual(['0:0', '0:1']);

    // Subsequent plays resolve so the retry can complete cleanly.
    sinkPlay.mockResolvedValue(undefined);

    await act(async () => {
      rejectSeg0();
      await Promise.resolve();
    });

    // The evicted key MUST be segment 0's, not the prefetched segment 1's.
    await waitFor(() => expect(cacheDeleteMock).toHaveBeenCalledTimes(1));
    expect(cacheDeleteMock).toHaveBeenCalledWith('key:0:0');
    // The retry re-fetched segment 0, not segment 1.
    await waitFor(() => expect(fetchedKeys).toContain('0:0'));
    expect(fetchedKeys.filter((k) => k === '0:0').length).toBe(2);
    expect(result.current.transportState).not.toBe('failed');
  });

  it('stop() clears the resume memory so the offer disappears (I1)', async () => {
    resolveTtsMock.mockResolvedValue(okResolution);
    rememberPosition('c1', { messageId: 'm1', segmentIndex: 1, paragraphIndex: 1 });
    const messages = [msg('m1', TWO_PARA)];
    const { result } = renderHook(() => useVoicePlayback('c1', persona, messages));

    expect(result.current.resumeOffer).toEqual({
      messageId: 'm1',
      segmentIndex: 1,
      paragraphIndex: 1,
    });

    act(() => {
      result.current.stop();
    });

    await waitFor(() => expect(result.current.resumeOffer).toBeNull());
    expect(peekPosition('c1')).toBeNull();
  });

  it('auto-skips a content refusal (403) and keeps reading, counting the skip', async () => {
    resolveTtsMock.mockResolvedValue(okResolution);
    // Segment 0:0 is declined on content grounds (403); 0:1 synthesises fine.
    okResolution.fetchAudio.mockImplementation(async (s: SpeechSegment) => {
      if (s.segmentId === '0:0')
        throw Object.assign(new Error('TTS upstream 403'), { status: 403 });
      return new Blob(['x'], { type: 'audio/mpeg' });
    });
    // Hold play open so the machine stays in speaking on the surviving segment.
    sinkPlay.mockImplementation(() => new Promise<void>(() => {}));

    const { result } = renderHook(() => useVoicePlayback('c1', persona, []));
    await act(async () => {
      await result.current.playMessage(msg('m1', TWO_PARA));
    });

    // The read advanced past the refused segment rather than halting.
    await waitFor(() => expect(result.current.currentSegmentId).toBe('0:1'));
    expect(result.current.transportState).toBe('speaking');
    expect(result.current.providerSkips).toBe(1);
  });

  it('clears the skipped-passage note on stop', async () => {
    resolveTtsMock.mockResolvedValue(okResolution);
    okResolution.fetchAudio.mockImplementation(async (s: SpeechSegment) => {
      if (s.segmentId === '0:0')
        throw Object.assign(new Error('TTS upstream 403'), { status: 403 });
      return new Blob(['x'], { type: 'audio/mpeg' });
    });
    sinkPlay.mockImplementation(() => new Promise<void>(() => {}));

    const { result } = renderHook(() => useVoicePlayback('c1', persona, []));
    await act(async () => {
      await result.current.playMessage(msg('m1', TWO_PARA));
    });
    await waitFor(() => expect(result.current.providerSkips).toBe(1));

    act(() => {
      result.current.stop();
    });
    await waitFor(() => expect(result.current.providerSkips).toBe(0));
  });

  it('keeps Retry for a transient failure (500) instead of auto-skipping', async () => {
    resolveTtsMock.mockResolvedValue(okResolution);
    okResolution.fetchAudio.mockImplementation(async (s: SpeechSegment) => {
      if (s.segmentId === '0:0')
        throw Object.assign(new Error('TTS upstream 500'), { status: 500 });
      return new Blob(['x'], { type: 'audio/mpeg' });
    });

    const { result } = renderHook(() => useVoicePlayback('c1', persona, []));
    await act(async () => {
      await result.current.playMessage(msg('m1', TWO_PARA));
    });

    await waitFor(() => expect(result.current.transportState).toBe('failed'));
    expect(result.current.providerSkips).toBe(0);
  });

  it('stops the active read when the voice mode changes mid-play (mode-desync guard)', async () => {
    resolveTtsMock.mockResolvedValue(okResolution);
    sinkPlay.mockImplementation(() => new Promise<void>(() => {})); // stay speaking

    const { result, rerender } = renderHook(() => useVoicePlayback('c1', persona, []));
    await act(async () => {
      await result.current.playMessage(msg('m1', TWO_PARA));
    });
    await waitFor(() => expect(result.current.transportState).toBe('speaking'));

    // Toggle the mode while speaking. The machine's frozen segment-id namespace
    // would otherwise desync from the live re-segmented spans → glow falls out.
    await act(async () => {
      settingsData.voiceMode = 'sentence';
      rerender();
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.transportState).toBe('idle'));
  });

  it('drops a stale resume offer when the voice mode changes while idle', async () => {
    resolveTtsMock.mockResolvedValue(okResolution);
    rememberPosition('c1', { messageId: 'm1', segmentIndex: 1, paragraphIndex: 1 });
    const messages = [msg('m1', TWO_PARA)];
    const { result, rerender } = renderHook(() => useVoicePlayback('c1', persona, messages));

    expect(result.current.resumeOffer).not.toBeNull();

    await act(async () => {
      settingsData.voiceMode = 'sentence';
      rerender();
      await Promise.resolve();
    });

    // The remembered segment index is mode-relative — a mode change invalidates it.
    await waitFor(() => expect(result.current.resumeOffer).toBeNull());
  });

  it('resume sends PLAY at the remembered index and clears the position', async () => {
    resolveTtsMock.mockResolvedValue(okResolution);
    sinkPlay.mockImplementation(() => new Promise<void>(() => {})); // stay speaking

    rememberPosition('c1', { messageId: 'm1', segmentIndex: 1, paragraphIndex: 1 });
    const messages = [msg('m1', TWO_PARA)];
    const { result } = renderHook(() => useVoicePlayback('c1', persona, messages));

    // Resume offer is visible before playback.
    expect(result.current.resumeOffer).toEqual({
      messageId: 'm1',
      segmentIndex: 1,
      paragraphIndex: 1,
    });

    await act(async () => {
      result.current.resume();
      await Promise.resolve();
    });

    await waitFor(() => expect(result.current.transportState).toBe('speaking'));
    // Started at the remembered segment (index 1 → second segment).
    expect(result.current.currentSegmentId).toBe('0:1');
    // Position cleared by the play.
    expect(peekPosition('c1')).toBeNull();
  });
});
