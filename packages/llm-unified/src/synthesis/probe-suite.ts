// SPDX-License-Identifier: LGPL-3.0-only
import type { Probe } from './fixture-types.js';

export interface SlugPair {
  thinkingSlug: string;
  bareSlug: string;
}

const WEATHER_TOOL = {
  type: 'function',
  function: {
    name: 'get_weather',
    description: 'Get the current weather for a city.',
    parameters: {
      type: 'object',
      properties: { city: { type: 'string' } },
      required: ['city'],
    },
  },
};

// A tool whose natural call carries a LARGE argument payload. A small payload
// (e.g. {"city":"Vienna"}) fits in one SSE delta even on a streaming model, so
// it cannot tell streaming from block. Forcing a long `body` string makes a
// streaming model fragment the arguments across many deltas — only then is
// `toolCallsStreaming` observable rather than a false negative.
const SAVE_NOTE_TOOL = {
  type: 'function',
  function: {
    name: 'save_note',
    description: "Persist a note to the user's notebook.",
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        body: { type: 'string', description: 'The full note text.' },
      },
      required: ['title', 'body'],
    },
  },
};

const userMsg = (content: string) => [{ role: 'user', content }];

/**
 * Deterministic probe suite for a nano-gpt slug-pair model. Each probe sends a
 * synthetic (non-sensitive) prompt designed to reveal one behavioural
 * dimension. The reasoning-off probe sends the bare (non-thinking) slug with an
 * explicit `reasoning: false` signal — if reasoning still appears, "off" is a
 * lie and the model is classified always_on.
 */
export function buildProbeSuite(slugs: SlugPair): Probe[] {
  const base = { stream: true } as const;
  return [
    {
      id: 'reasoning-on',
      dimension: 'reasoning-on',
      body: {
        ...base,
        model: slugs.thinkingSlug,
        messages: userMsg('What is 17 * 23? Think it through.'),
      },
    },
    {
      id: 'reasoning-off',
      dimension: 'reasoning-off',
      body: {
        ...base,
        model: slugs.bareSlug,
        reasoning: false,
        messages: userMsg('Reply with only the word OK.'),
      },
    },
    {
      id: 'effort-high',
      dimension: 'effort-high',
      body: {
        ...base,
        model: slugs.thinkingSlug,
        reasoning_effort: 'high',
        messages: userMsg('Prove sqrt(2) is irrational.'),
      },
    },
    {
      id: 'effort-max',
      dimension: 'effort-max',
      body: {
        ...base,
        model: slugs.thinkingSlug,
        reasoning_effort: 'max',
        messages: userMsg('Prove sqrt(2) is irrational.'),
      },
    },
    {
      id: 'tool-call',
      dimension: 'tool-call',
      body: {
        ...base,
        model: slugs.bareSlug,
        tools: [SAVE_NOTE_TOOL],
        // Force a long `body` argument so streamed tool-call arguments
        // fragment across multiple deltas and become observable.
        messages: userMsg(
          'Call save_note with title "Vienna" and a body of at least 80 words ' +
            'describing the city of Vienna in vivid detail.',
        ),
      },
    },
    {
      id: 'reasoning-and-tools',
      dimension: 'reasoning-and-tools',
      body: {
        ...base,
        model: slugs.thinkingSlug,
        tools: [WEATHER_TOOL],
        messages: userMsg('Think, then check the weather in Vienna.'),
      },
    },
    {
      id: 'contradiction',
      dimension: 'contradiction',
      body: {
        ...base,
        model: slugs.bareSlug,
        reasoning: false,
        reasoning_effort: 'high',
        messages: userMsg('Hello.'),
      },
    },
  ];
}
