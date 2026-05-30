// SPDX-License-Identifier: LGPL-3.0-only
import type { ReasoningIntent, WireMessage } from '../../src/types.js';
import type { Assertion } from './types.js';

export interface ScenarioTurn {
  id: string;
  /** Messages to send this turn (user/tool side), relative to prior turns. */
  send: WireMessage[];
  /** Deterministic assertions applied to this turn's outcome. */
  assertions: Assertion[];
  /**
   * If set, the named tool is expected to fire; the runner synthesises a tool
   * result for the following turn so the conversation can continue.
   */
  expectToolCall?: string;
}

export interface ReasoningPermutation {
  /** e.g. 'reasoning-off', 'reasoning-on', 'effort:low'. */
  label: string;
  intent: ReasoningIntent;
}

export interface ConversationScenario {
  id: string;
  description: string;
  turns: ScenarioTurn[];
}
