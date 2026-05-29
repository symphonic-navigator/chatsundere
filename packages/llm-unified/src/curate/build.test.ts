// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from 'bun:test';
import { buildOffering } from './build.js';
import type { HumanOffering } from './model-file.js';

const human: HumanOffering = {
  provider: 'nano-gpt',
  upstreamSlug: 'zai-org/glm-6',
  trust: { tee: false, zdr: false },
  freedomOrientedDeployment: false,
  context: { recommended: 128000, max: 200000 },
};

const profile = {
  reasoning: { mode: 'toggle', defaultOn: true } as const,
  toolCalls: { supported: true, streaming: false, concurrentWithReasoning: true },
  vision: false,
  replayReasoning: false,
};

describe('buildOffering', () => {
  it('runs the loop and returns a verified built entry + adapter source on success', async () => {
    const result = await buildOffering({
      human,
      canonicalId: 'glm-6',
      runLoop: async () => ({
        outcome: 'verified',
        adapterSource: 'export const adapter = {};',
        profile,
      }),
    });
    expect(result.built.ref).toBe('nano-gpt:glm-6');
    expect(result.built.confidence).toBe('verified');
    expect(result.built.adapterFile).toBe('glm-6.nano-gpt.adapter.ts');
    expect(result.adapterSource).toContain('adapter');
    expect(result.built.profile.toolCalls.streaming).toBe(false);
  });

  it('marks heuristic confidence on fallback', async () => {
    const result = await buildOffering({
      human,
      canonicalId: 'glm-6',
      runLoop: async () => ({ outcome: 'heuristic-fallback', adapterSource: null, profile }),
    });
    expect(result.built.confidence).toBe('heuristic');
  });
});
