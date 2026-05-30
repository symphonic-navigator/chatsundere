// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, test } from 'bun:test';
import {
  assertMemoryEchoed,
  assertNoHttpError,
  assertNoStreamError,
  assertReasoningAbsent,
  assertReasoningPresent,
  assertToolArgsValidJson,
  assertToolCallFired,
  assertUsagePresent,
} from './assertions.js';
import type { TurnOutcome } from './types.js';

function outcome(partial: Partial<TurnOutcome>): TurnOutcome {
  return {
    httpStatus: 200,
    chunks: [],
    text: '',
    reasoning: '',
    toolCalls: [],
    usage: null,
    finishReason: null,
    ...partial,
  };
}

describe('assertNoHttpError', () => {
  test('passes on 200', () => {
    expect(assertNoHttpError(outcome({ httpStatus: 200 })).status).toBe('pass');
  });
  test('fails on 400 (the MiMo/chutes case)', () => {
    const r = assertNoHttpError(outcome({ httpStatus: 400 }));
    expect(r.status).toBe('fail');
    expect(r.detail).toContain('400');
  });
});

describe('assertNoStreamError', () => {
  test('passes when no error chunk was emitted', () => {
    const r = assertNoStreamError(outcome({ chunks: [{ type: 'token', text: 'hi' }] }));
    expect(r.status).toBe('pass');
  });
  test('fails when an error chunk was emitted mid-stream', () => {
    const r = assertNoStreamError(
      outcome({
        chunks: [
          { type: 'token', text: 'hi' },
          { type: 'error', message: 'boom' },
        ],
      }),
    );
    expect(r.status).toBe('fail');
  });
});

describe('assertToolCallFired', () => {
  test('fails when the model produced text but did not fire the tool', () => {
    const r = assertToolCallFired('generate_image')(
      outcome({ text: 'Here is a prompt for an image...' }),
    );
    expect(r.status).toBe('fail');
  });
  test('passes when the tool fired', () => {
    const r = assertToolCallFired('generate_image')(
      outcome({
        toolCalls: [{ id: 'call_1', name: 'generate_image', argumentsJson: '{"prompt":"x"}' }],
      }),
    );
    expect(r.status).toBe('pass');
  });
});

describe('assertToolArgsValidJson', () => {
  test('fails on malformed arguments', () => {
    const r = assertToolArgsValidJson('generate_image')(
      outcome({ toolCalls: [{ id: 'call_1', name: 'generate_image', argumentsJson: '{prompt:' }] }),
    );
    expect(r.status).toBe('fail');
  });
  test('passes on valid JSON args', () => {
    const r = assertToolArgsValidJson('generate_image')(
      outcome({
        toolCalls: [{ id: 'call_1', name: 'generate_image', argumentsJson: '{"prompt":"x"}' }],
      }),
    );
    expect(r.status).toBe('pass');
  });
});

describe('assertUsagePresent', () => {
  test('fails when usage missing', () => {
    expect(assertUsagePresent(outcome({ usage: null })).status).toBe('fail');
  });
  test('passes when usage normalised', () => {
    const r = assertUsagePresent(
      outcome({ usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } }),
    );
    expect(r.status).toBe('pass');
  });
});

describe('reasoning presence', () => {
  test('assertReasoningPresent fails when empty', () => {
    expect(assertReasoningPresent(outcome({ reasoning: '' })).status).toBe('fail');
  });
  test('assertReasoningPresent passes when present', () => {
    expect(assertReasoningPresent(outcome({ reasoning: 'let me think' })).status).toBe('pass');
  });
  test('assertReasoningAbsent passes when empty (reasoning-off permutation)', () => {
    expect(assertReasoningAbsent(outcome({ reasoning: '' })).status).toBe('pass');
  });
  test('assertReasoningAbsent fails when reasoning leaked despite off', () => {
    expect(assertReasoningAbsent(outcome({ reasoning: 'oops' })).status).toBe('fail');
  });
});

describe('assertMemoryEchoed', () => {
  test('passes when the memory token appears in the reply', () => {
    const r = assertMemoryEchoed('cat lover')(outcome({ text: 'As a cat lover, you...' }));
    expect(r.status).toBe('pass');
  });
  test('fails when the memory token is absent', () => {
    const r = assertMemoryEchoed('cat lover')(outcome({ text: 'Hello there.' }));
    expect(r.status).toBe('fail');
  });
});
