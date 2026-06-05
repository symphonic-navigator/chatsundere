// SPDX-License-Identifier: LGPL-3.0-only
import type { Assertion, AssertionResult, TurnOutcome } from './types.js';

/** Upstream returned a non-error status. Catches the MiMo/chutes 400 case. */
export function assertNoHttpError(outcome: TurnOutcome): AssertionResult {
  const ok = outcome.httpStatus >= 200 && outcome.httpStatus < 300;
  return {
    assertion: 'no-http-error',
    status: ok ? 'pass' : 'fail',
    detail: ok ? `HTTP ${outcome.httpStatus}` : `HTTP ${outcome.httpStatus} (expected 2xx)`,
  };
}

/** No mid-stream error chunk was emitted (catches malformed SSE from a provider). */
export function assertNoStreamError(outcome: TurnOutcome): AssertionResult {
  const errored = outcome.chunks.some((c) => c.type === 'error');
  return {
    assertion: 'no-stream-error',
    status: errored ? 'fail' : 'pass',
    detail: errored ? 'an error chunk was emitted mid-stream' : 'no stream error',
  };
}

/** The named tool actually fired (not: the model merely talked about it). */
export function assertToolCallFired(toolName: string): Assertion {
  return (outcome) => {
    const fired = outcome.toolCalls.some((t) => t.name === toolName);
    return {
      assertion: `tool-call-fired:${toolName}`,
      status: fired ? 'pass' : 'fail',
      detail: fired
        ? `${toolName} fired`
        : `${toolName} did not fire (model produced text instead of calling the tool)`,
    };
  };
}

/** The named tool's arguments parse as JSON. */
export function assertToolArgsValidJson(toolName: string): Assertion {
  return (outcome) => {
    const call = outcome.toolCalls.find((t) => t.name === toolName);
    if (!call) {
      return {
        assertion: `tool-args-valid-json:${toolName}`,
        status: 'fail',
        detail: `${toolName} did not fire, so no arguments to validate`,
      };
    }
    try {
      JSON.parse(call.argumentsJson);
      return {
        assertion: `tool-args-valid-json:${toolName}`,
        status: 'pass',
        detail: 'arguments are valid JSON',
      };
    } catch (e) {
      return {
        assertion: `tool-args-valid-json:${toolName}`,
        status: 'fail',
        detail: `arguments are not valid JSON: ${(e as Error).message}`,
      };
    }
  };
}

/** Usage was surfaced and normalised. */
export function assertUsagePresent(outcome: TurnOutcome): AssertionResult {
  const ok = outcome.usage !== null && outcome.usage.totalTokens > 0;
  return {
    assertion: 'usage-present',
    status: ok ? 'pass' : 'fail',
    detail: ok ? `total ${outcome.usage?.totalTokens} tokens` : 'no normalised usage surfaced',
  };
}

/** Reasoning text was emitted (for reasoning-on permutations). */
export function assertReasoningPresent(outcome: TurnOutcome): AssertionResult {
  const ok = outcome.reasoning.trim().length > 0;
  return {
    assertion: 'reasoning-present',
    status: ok ? 'pass' : 'fail',
    detail: ok ? 'reasoning channel populated' : 'no reasoning emitted',
  };
}

/** No reasoning leaked (for reasoning-off permutations). */
export function assertReasoningAbsent(outcome: TurnOutcome): AssertionResult {
  const ok = outcome.reasoning.trim().length === 0;
  return {
    assertion: 'reasoning-absent',
    status: ok ? 'pass' : 'fail',
    detail: ok ? 'no reasoning leaked' : 'reasoning emitted despite being turned off',
  };
}

/**
 * An image's expected content was described in the reply — i.e. the image was
 * carried through the protocol to the model. Like `memory-echoed`, the directness
 * of the prompt keeps this a PIPE check, not an intelligence judgement: a model
 * that never received the image answers "I can't see an image" (no token), while
 * any model that received it names the unambiguous content.
 */
export function assertVisionDescribed(token: string): Assertion {
  return (outcome) => {
    const ok = outcome.text.toLowerCase().includes(token.toLowerCase());
    return {
      assertion: `vision-described:${token}`,
      status: ok ? 'pass' : 'fail',
      detail: ok
        ? `reply references "${token}"`
        : `reply does not reference "${token}" (image not carried through the protocol)`,
    };
  };
}

/** A memory token was echoed through the protocol into the reply. */
export function assertMemoryEchoed(token: string): Assertion {
  return (outcome) => {
    const ok = outcome.text.toLowerCase().includes(token.toLowerCase());
    return {
      assertion: `memory-echoed:${token}`,
      status: ok ? 'pass' : 'fail',
      detail: ok
        ? `reply references "${token}"`
        : `reply does not reference "${token}" (memory not carried through the protocol)`,
    };
  };
}
