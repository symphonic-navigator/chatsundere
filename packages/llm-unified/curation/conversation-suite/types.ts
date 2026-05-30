// SPDX-License-Identifier: LGPL-3.0-only
import type { NormalisedUsage, StreamChunk } from '../../src/types.js';

/** The assembled result of running one conversation turn against a model. */
export interface TurnOutcome {
  /** HTTP status of the upstream call (200-class = ok). */
  httpStatus: number;
  /** Raw assembled adapter output for the turn. */
  chunks: StreamChunk[];
  /** Concatenated `token` chunk text. */
  text: string;
  /** Concatenated `reasoning` chunk text. */
  reasoning: string;
  /** Tool calls the model emitted this turn. */
  toolCalls: { name: string; argumentsJson: string }[];
  /** Normalised usage if the adapter surfaced it, else null. */
  usage: NormalisedUsage | null;
  /** Finish reason if seen, else null. */
  finishReason: string | null;
}

export type AssertionStatus = 'pass' | 'fail';

export interface AssertionResult {
  /** Stable machine label, e.g. `tool-call-fired:generate_image`. */
  assertion: string;
  status: AssertionStatus;
  /** Human-readable explanation of the verdict. */
  detail: string;
}

/** A deterministic, pure check over a single turn's outcome. */
export type Assertion = (outcome: TurnOutcome) => AssertionResult;
