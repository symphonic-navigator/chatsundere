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
        tools: [WEATHER_TOOL],
        messages: userMsg('What is the weather in Vienna?'),
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
