// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  claimMediaFloor,
  currentFloorOwner,
  releaseMediaFloor,
} from '../../../src/lib/media/media-floor.js';

afterEach(() => {
  const o = currentFloorOwner();
  if (o) releaseMediaFloor(o);
});

describe('media floor', () => {
  it('yields the previous owner once when another claims', () => {
    const a = vi.fn();
    const b = vi.fn();
    claimMediaFloor('player:a', a);
    claimMediaFloor('player:b', b);
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
    expect(currentFloorOwner()).toBe('player:b');
  });

  it('does not yield when the owner re-claims', () => {
    const a = vi.fn();
    claimMediaFloor('player:a', a);
    claimMediaFloor('player:a', a);
    expect(a).not.toHaveBeenCalled();
  });

  it('ignores a release by a non-owner', () => {
    claimMediaFloor('player:a', vi.fn());
    releaseMediaFloor('player:b');
    expect(currentFloorOwner()).toBe('player:a');
  });

  it('never calls any yield on release', () => {
    const a = vi.fn();
    claimMediaFloor('player:a', a);
    releaseMediaFloor('player:a');
    expect(a).not.toHaveBeenCalled();
    expect(currentFloorOwner()).toBeNull();
  });
});
