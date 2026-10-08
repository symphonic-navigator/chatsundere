// SPDX-License-Identifier: LGPL-3.0-only
import type { WireMessage } from '../../../src/types.js';
import {
  assertNoHttpError,
  assertNoStreamError,
  assertNotToolShaped,
  assertTextPresent,
  assertToolArgsValidJson,
  assertToolCallFired,
} from '../assertions.js';
import type { ConversationScenario } from '../scenario.js';

/**
 * A history exactly as the client replays it (tool history replay spec §3): an
 * earlier generate_image round with a provider-neutral 9-character id, its
 * result, and the persona's prose answer.
 */
export const REPLAYED_TOOL_HISTORY: WireMessage[] = [
  { role: 'user', content: 'Please create an image of a red fox in the snow.' },
  {
    role: 'assistant',
    content: '',
    tool_calls: [
      {
        id: 'k3F9aZ1qP',
        type: 'function',
        function: {
          name: 'generate_image',
          arguments: '{"prompt":"a red fox standing in fresh snow"}',
        },
      },
    ],
  },
  {
    role: 'tool',
    tool_call_id: 'k3F9aZ1qP',
    content:
      'Generated 1 image(s) from your prompt. They are already displayed to the user — refer to them in prose; do not output URLs, file paths, or markdown images.',
  },
  { role: 'assistant', content: 'Here is your fox in the snow — I hope you like its winter coat!' },
];

/**
 * Gate: after a replayed tool round, a DIRECT instruction must produce a real
 * call on the tool channel. Directness keeps this a pipe check (design D8): a
 * working pipe always yields the call, and a poisoned history is precisely what
 * makes a model answer in prose instead (Mistral Large 4, 2026-10-07).
 */
export const toolReplayScenario: ConversationScenario = {
  id: 'tool-replay',
  description: 'A replayed tool round in history; the model must still call the tool.',
  turns: [
    {
      id: 'replayed-tool-history',
      send: [
        ...REPLAYED_TOOL_HISTORY,
        {
          role: 'user',
          content: 'Now call generate_image again with the prompt "a lighthouse at dusk".',
        },
      ],
      expectToolCall: 'generate_image',
      assertions: [
        assertNoHttpError,
        assertNoStreamError,
        assertToolCallFired('generate_image'),
        assertToolArgsValidJson('generate_image'),
        assertNotToolShaped,
      ],
    },
  ],
};

/**
 * Informational, not a gate: run with a binding that offers NO tools. A 2xx
 * plus a text reply means the provider accepts orphaned replayed calls
 * (`toolCalls.orphanReplay: true`); an HTTP 400 means it does not (keep false).
 */
export const orphanReplayScenario: ConversationScenario = {
  id: 'orphan-tool-replay',
  description: 'Replayed tool round whose tool is absent from the request (sets orphanReplay).',
  turns: [
    {
      id: 'orphan-tool-replay',
      send: [
        ...REPLAYED_TOOL_HISTORY,
        { role: 'user', content: 'In one short sentence: what did you make for me earlier?' },
      ],
      assertions: [assertNoHttpError, assertNoStreamError, assertTextPresent],
    },
  ],
};

/**
 * Gate: a replayed persona message that ended on a tool round — an interrupted
 * or pending call, or a forced-answer pass that only emitted a call — has no
 * closing assistant message, so the wire reads `assistant(tool_calls), tool,
 * user`. Some providers (historically Mistral) reject a user turn straight
 * after a tool message. A FAIL means the client must emit a closing assistant
 * message for that case.
 */
export const toolThenUserScenario: ConversationScenario = {
  id: 'tool-then-user',
  description: 'Replayed history ending on a tool result, followed directly by a user turn.',
  turns: [
    {
      id: 'tool-then-user',
      send: [
        ...REPLAYED_TOOL_HISTORY.slice(0, 3),
        { role: 'user', content: 'Thanks! In one short sentence, what did you make for me?' },
      ],
      assertions: [assertNoHttpError, assertNoStreamError, assertTextPresent],
    },
  ],
};
