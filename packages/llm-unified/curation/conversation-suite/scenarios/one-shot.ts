// SPDX-License-Identifier: LGPL-3.0-only
import { assertNoHttpError, assertTextPresent } from '../assertions.js';
import type { ConversationScenario } from '../scenario.js';

/**
 * The background-job entry point (`runOneShotCompletion`) — the path title
 * generation, memory and compaction take. The core scenario only ever exercised
 * the chat entry point, which is why every Ollama background job could 404 while
 * the suite reported "core 11/11, verified" (2026-07-17). One turn, shaped like
 * real title generation.
 */
export const oneShotScenario: ConversationScenario = {
  id: 'one-shot',
  description: 'The non-streaming background-job path returns usable content.',
  turns: [
    {
      id: 'one-shot-title',
      send: [
        { role: 'system', content: 'Reply with a short chat title only. No preamble.' },
        { role: 'user', content: 'How do I sort a list in Python?' },
      ],
      assertions: [assertNoHttpError, assertTextPresent],
    },
  ],
};
