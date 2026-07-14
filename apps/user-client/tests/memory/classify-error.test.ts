// SPDX-License-Identifier: AGPL-3.0-only
import { describe, expect, it } from 'vitest';
import { classifyMemoryActionError } from '../../src/memory/classify-error.js';
import { MemoryInvalidOutputError } from '../../src/memory/pipeline.js';

function statusError(status: number): Error & { status: number } {
  const e = new Error(`one-shot upstream returned ${status}`) as Error & { status: number };
  e.status = status;
  return e;
}

describe('classifyMemoryActionError', () => {
  it.each([
    [new Error('memory-learn: master key unavailable — re-authenticate'), 'no-credentials'],
    [new MemoryInvalidOutputError(), 'invalid-output'],
    [new DOMException('The operation timed out.', 'TimeoutError'), 'timeout'],
    [new DOMException('Aborted', 'AbortError'), 'timeout'],
    [statusError(429), 'upstream-busy'],
    [statusError(500), 'upstream-busy'],
    [statusError(503), 'upstream-busy'],
    [statusError(400), 'failed'],
    [new Error('anything else'), 'failed'],
    ['not even an error', 'failed'],
  ])('classifies %s as %s', (input, expected) => {
    expect(classifyMemoryActionError(input)).toBe(expected);
  });
});
