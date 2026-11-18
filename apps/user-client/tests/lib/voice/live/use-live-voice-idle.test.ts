// SPDX-License-Identifier: AGPL-3.0-only
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Floor } from '../../../../src/lib/voice/live/live-voice-machine.js';
import { useLiveVoiceIdle } from '../../../../src/lib/voice/live/use-live-voice-idle.js';

const FIVE_MIN = 300_000;

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function setup(floor: Floor, isLiveVoice = true) {
  return renderHook(({ f, live }) => useLiveVoiceIdle(f, live), {
    initialProps: { f: floor, live: isLiveVoice },
  });
}

describe('useLiveVoiceIdle', () => {
  it('turns true after five minutes of unbroken listening', () => {
    const { result } = setup('listening');
    act(() => vi.advanceTimersByTime(FIVE_MIN - 1));
    expect(result.current).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe(true);
  });

  it('resets at once on another floor and restarts the five minutes', () => {
    const { result, rerender } = setup('listening');
    act(() => vi.advanceTimersByTime(FIVE_MIN));
    expect(result.current).toBe(true);

    rerender({ f: 'userSpeaking', live: true });
    expect(result.current).toBe(false);

    rerender({ f: 'listening', live: true });
    act(() => vi.advanceTimersByTime(FIVE_MIN - 1));
    expect(result.current).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe(true);
  });

  it('counts held and a failed transcription as quiet, without restarting', () => {
    const { result, rerender } = setup('listening');
    act(() => vi.advanceTimersByTime(FIVE_MIN / 2));
    rerender({ f: 'held', live: true });
    act(() => vi.advanceTimersByTime(FIVE_MIN / 4));
    rerender({ f: 'sttFailed', live: true });
    act(() => vi.advanceTimersByTime(FIVE_MIN / 4));
    expect(result.current).toBe(true);
  });

  it('speech before the ceiling restarts the count', () => {
    const { result, rerender } = setup('listening');
    act(() => vi.advanceTimersByTime(FIVE_MIN - 1000));
    rerender({ f: 'userSpeaking', live: true });
    rerender({ f: 'listening', live: true });
    act(() => vi.advanceTimersByTime(2000));
    expect(result.current).toBe(false);
  });

  it('stays false outside live voice and resets when live voice ends', () => {
    const { result, rerender } = setup('listening', false);
    act(() => vi.advanceTimersByTime(FIVE_MIN));
    expect(result.current).toBe(false);

    rerender({ f: 'listening', live: true });
    act(() => vi.advanceTimersByTime(FIVE_MIN));
    expect(result.current).toBe(true);
    rerender({ f: 'listening', live: false });
    expect(result.current).toBe(false);
  });
});
