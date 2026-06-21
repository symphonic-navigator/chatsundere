// SPDX-License-Identifier: AGPL-3.0-only
import { afterEach, describe, expect, it } from 'vitest';
import {
  _resetMemoryLocksForTests,
  releaseMemoryLock,
  tryAcquireMemoryLock,
} from '../../src/memory/mutex.js';

afterEach(() => _resetMemoryLocksForTests());

describe('memory mutex', () => {
  it('grants the first acquire and refuses a second for the same persona', () => {
    expect(tryAcquireMemoryLock('p1')).toBe(true);
    expect(tryAcquireMemoryLock('p1')).toBe(false);
  });
  it('allows different personas concurrently', () => {
    expect(tryAcquireMemoryLock('p1')).toBe(true);
    expect(tryAcquireMemoryLock('p2')).toBe(true);
  });
  it('re-acquires after release', () => {
    tryAcquireMemoryLock('p1');
    releaseMemoryLock('p1');
    expect(tryAcquireMemoryLock('p1')).toBe(true);
  });
});
