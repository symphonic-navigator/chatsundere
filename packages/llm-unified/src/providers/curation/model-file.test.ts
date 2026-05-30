// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from 'bun:test';
import { assembleOfferings, parseModelFile, renderTemplate } from './model-file.js';

const fileObj = {
  canonical: {
    id: 'glm-6',
    displayName: 'GLM 6',
    family: 'glm',
    requiredCaps: { tools: true, reasoning: true, vision: false },
    freedomOriented: true,
  },
  offerings: [
    {
      provider: 'nano-gpt',
      upstreamSlug: 'zai-org/glm-6',
      trust: { tee: false, zdr: false },
      freedomOrientedDeployment: false,
      context: { recommended: 128000, max: 200000 },
    },
  ],
  built: [
    {
      ref: 'nano-gpt:glm-6',
      adapterFile: 'glm-6.nano-gpt.adapter.ts',
      profile: {
        reasoning: { mode: 'toggle', defaultOn: true },
        toolCalls: { supported: true, streaming: false, concurrentWithReasoning: true },
        vision: false,
        replayReasoning: false,
      },
      confidence: 'verified',
    },
  ],
};

describe('parseModelFile', () => {
  it('accepts a well-formed model file', () => {
    expect(parseModelFile(fileObj).ok).toBe(true);
  });
  it('rejects a file missing canonical.id', () => {
    expect(parseModelFile({ offerings: [] }).ok).toBe(false);
  });
});

describe('assembleOfferings', () => {
  it('merges human offering + built block into a full Offering', () => {
    const parsed = parseModelFile(fileObj);
    if (!parsed.ok) throw new Error('precondition');
    const offerings = assembleOfferings(parsed.file);
    expect(offerings).toHaveLength(1);
    // biome-ignore lint/style/noNonNullAssertion: fixture is statically non-empty
    const o = offerings[0]!;
    expect(o.canonicalRef).toBe('glm-6');
    expect(o.providerId).toBe('nano-gpt');
    expect(o.adapter).toEqual({ kind: 'catalogue', adapterId: 'glm-6.nano-gpt.adapter.ts' });
    expect(o.profile.toolCalls.streaming).toBe(false);
    expect(o.source).toBe('curated');
    expect(o.confidence).toBe('verified');
    expect(o.context).toEqual({ recommended: 128000, max: 200000 });
  });
  it('throws when an offering has no matching built entry (not built yet)', () => {
    const noBuild = { ...fileObj, built: [] };
    const parsed = parseModelFile(noBuild);
    if (!parsed.ok) throw new Error('precondition');
    expect(() => assembleOfferings(parsed.file)).toThrow(/not built/i);
  });
});

describe('renderTemplate', () => {
  it('emits a YAML skeleton with mechanical fields filled and judgement fields blank', () => {
    const yaml = renderTemplate({
      canonicalId: 'glm-6',
      displayName: 'GLM 6',
      family: 'glm',
      offerings: [{ provider: 'nano-gpt', upstreamSlug: 'zai-org/glm-6' }],
    });
    expect(yaml).toContain('id: glm-6');
    expect(yaml).toContain('provider: nano-gpt');
    expect(yaml).toContain('upstreamSlug: zai-org/glm-6');
    expect(yaml).toMatch(/freedomOriented:\s*$/m);
    expect(yaml).toContain('# --- human-curated ---');
  });
});
