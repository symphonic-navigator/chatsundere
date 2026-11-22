// SPDX-License-Identifier: AGPL-3.0-only
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { claimMediaFloor, currentFloorOwner } from '../../../src/lib/media/media-floor.js';
import { useMediaFloorBridge } from '../../../src/lib/media/use-media-floor-bridge.js';
import type { Floor } from '../../../src/lib/voice/live/live-voice-machine.js';
import type { TransportState } from '../../../src/lib/voice/voice-machine.js';

interface Props {
  v: TransportState;
  m?: TransportState;
  floor?: Floor;
}

describe('useMediaFloorBridge', () => {
  it('claims on speaking, yields to a player and releases on pause', () => {
    const pause = vi.fn();
    const { rerender, unmount } = renderHook(
      ({ v, m = 'idle', floor = 'idle' }: Props) =>
        useMediaFloorBridge({
          voice: { transportState: v, pause } as never,
          monologue: { transportState: m, pause: vi.fn() },
          live: { floor, hold: vi.fn() },
        }),
      { initialProps: { v: 'speaking' } as Props },
    );
    expect(currentFloorOwner()).toBe('read-aloud');
    act(() => claimMediaFloor('player:x', vi.fn()));
    expect(pause).toHaveBeenCalledTimes(1);
    rerender({ v: 'paused' });
    // The player holds the floor; the paused read-aloud must not release it.
    expect(currentFloorOwner()).toBe('player:x');
    unmount();
  });

  it('releases when speaking ends and holds live voice on yield', () => {
    const hold = vi.fn();
    const { rerender } = renderHook(
      ({ v, floor = 'idle' }: Props) =>
        useMediaFloorBridge({
          voice: { transportState: v, pause: vi.fn() } as never,
          monologue: { transportState: 'idle', pause: vi.fn() },
          live: { floor, hold },
        }),
      { initialProps: { v: 'speaking' } as Props },
    );
    expect(currentFloorOwner()).toBe('read-aloud');
    rerender({ v: 'paused' });
    expect(currentFloorOwner()).toBeNull();
    rerender({ v: 'idle', floor: 'listening' });
    expect(currentFloorOwner()).toBe('live-voice');
    act(() => claimMediaFloor('player:y', vi.fn()));
    expect(hold).toHaveBeenCalledTimes(1);
    rerender({ v: 'idle', floor: 'idle' });
    expect(currentFloorOwner()).toBe('player:y');
  });
});
