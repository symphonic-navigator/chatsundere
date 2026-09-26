// SPDX-License-Identifier: LGPL-3.0-only
import {
  assertMemoryEchoed,
  assertNoHttpError,
  assertNoStreamError,
  assertNotToolShaped,
  assertTextPresent,
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
      // The reasoning probe AND the base-completion turn in one. The
      // permutation-scoped reasoning assertions (present/absent) run on this
      // first turn (see runner.ts), so the prompt should genuinely warrant
      // reasoning rather than being a one-word greeting — asserting
      // `reasoning-present` on "say hello" was always conceptually wrong. A
      // non-famous arithmetic word problem exercises the channel without being a
      // memorised riddle answered reflexively. We assert only that the channel
      // is populated (on) or empty (off) — NEVER whether the answer (3 hardbacks)
      // is correct (D8: validate the pipe, never the intelligence).
      id: 'reasoning-probe',
      send: [
        {
          role: 'user',
          content:
            'A bookshop sells paperbacks for £8 and hardbacks for £14. On Monday it sold 7 books for a total of £74. How many hardbacks were sold?',
        },
      ],
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
      // Sends nothing new: the history already ends in the synthesised tool
      // result, so this asks for the model's reply TO that result. Before
      // 2026-09-26 no turn did; the next turn appended system + user messages
      // straight after the tool result. Gemma 4 via vLLM then answered tool
      // results with ReAct-style JSON (a chat-template defect) while every
      // assertion stayed green. `continuation-not-tool-shaped` is a pipe check:
      // a call written as text instead of sent through the tool channel.
      id: 'tool-result-continuation',
      send: [],
      requiresToolResult: true,
      assertions: [
        assertNoHttpError,
        assertNoStreamError,
        assertTextPresent,
        assertNotToolShaped,
        assertUsagePresent,
      ],
    },
    {
      // This turn injects a `system` message mid-conversation (third in the
      // accumulated history) deliberately, to exercise memory carry, then asks
      // a DIRECT recall question. The directness is the point: it keeps the
      // assertion a pure protocol check (design D8 — validate the pipe, never
      // the intelligence). An open-ended prompt ("suggest a weekend activity")
      // made `memory-echoed` flaky — it measured whether the model chose to
      // weave the fact in, i.e. its intelligence, not whether the fact was
      // carried through. A direct question removes that: a working pipe always
      // surfaces the fact, and a model that never received it cannot fabricate
      // it. Two caveats remain and are now CORRECT signals, not noise: many
      // OpenAI-compatible providers accept `system` only as the FIRST message
      // and may 400 (caught by `no-http-error`) or silently strip a later one
      // — a stripped fact now deterministically fails `memory-echoed`, which is
      // exactly the protocol fault we want surfaced. The fact must use a word no
      // other turn mentions: the earlier "cat lover" fact was echo-able from the
      // calico-cat image request, so a stripped system message could still pass.
      id: 'memory-echo',
      send: [
        { role: 'system', content: 'Known fact about the user: the user plays the bassoon.' },
        {
          role: 'user',
          content:
            'What is the single fact you have been told about me? Reply in one short sentence.',
        },
      ],
      assertions: [assertNoHttpError, assertMemoryEchoed('bassoon'), assertUsagePresent],
    },
  ],
};
