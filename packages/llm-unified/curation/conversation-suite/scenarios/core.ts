// SPDX-License-Identifier: LGPL-3.0-only
import {
  assertMemoryEchoed,
  assertNoHttpError,
  assertNoStreamError,
  assertToolArgsValidJson,
  assertToolCallFired,
  assertUsagePresent,
} from '../assertions.js';
import type { ConversationScenario } from '../scenario.js';

/**
 * The core capability scenario. It must GROW with the inference-runner's
 * capabilities (see CLAUDE.md §10): every new capability the runner gains gets
 * a turn here. Validation is purely technical/protocol — never a judgement of
 * the model's intelligence (a model being "dumb as bread" is a weights problem,
 * not a communication problem).
 */
export const coreScenario: ConversationScenario = {
  id: 'core',
  description: 'Tool call (generate_image), tool-result round-trip, and memory echo.',
  turns: [
    {
      id: 'plain-completion',
      send: [{ role: 'user', content: 'Reply with a one-sentence greeting.' }],
      assertions: [assertNoHttpError, assertNoStreamError, assertUsagePresent],
    },
    {
      id: 'tool-call-generate-image',
      send: [
        {
          role: 'user',
          content: 'Please create an image of a calico cat asleep on a windowsill.',
        },
      ],
      expectToolCall: 'generate_image',
      assertions: [
        assertNoHttpError,
        assertToolCallFired('generate_image'),
        assertToolArgsValidJson('generate_image'),
        assertUsagePresent,
      ],
    },
    {
      // This turn injects a `system` message mid-conversation (third in the
      // accumulated history) deliberately, to exercise memory carry. Many
      // OpenAI-compatible providers only accept `system` as the FIRST message
      // and may 400 or silently strip a later one. A red `no-http-error` here
      // therefore reflects a provider limitation, not necessarily an adapter
      // fault — a future curator should read it with that caveat in mind.
      id: 'memory-echo',
      send: [
        { role: 'system', content: 'Known fact about the user: the user is a cat lover.' },
        { role: 'user', content: 'Suggest a weekend activity for me.' },
      ],
      assertions: [assertNoHttpError, assertMemoryEchoed('cat'), assertUsagePresent],
    },
  ],
};
