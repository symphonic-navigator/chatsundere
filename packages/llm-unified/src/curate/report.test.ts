// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from 'bun:test';
import type { CanonicalModel, Offering } from '../catalogue/types.js';
import { renderReport } from './report.js';

const canonical: CanonicalModel = {
  id: 'glm-6',
  displayName: 'GLM 6',
  family: 'glm',
  requiredCaps: { tools: true, reasoning: true, vision: false },
  freedomOriented: true,
};

const offerings: Offering[] = [
  {
    canonicalRef: 'glm-6',
    providerId: 'nano-gpt',
    upstreamSlug: 'zai-org/glm-6',
    adapter: { kind: 'catalogue', adapterId: 'glm-6.nano-gpt.adapter.ts' },
    profile: {
      reasoning: { mode: 'toggle', defaultOn: true },
      toolCalls: { supported: true, streaming: false, concurrentWithReasoning: true },
      vision: false,
      replayReasoning: false,
    },
    context: { recommended: 128000, max: 200000 },
    trust: { tee: false, zdr: false },
    freedomOrientedDeployment: false,
    source: 'curated',
    confidence: 'verified',
  },
];

describe('renderReport', () => {
  it('renders identity, offerings, badges and freedom honestly', () => {
    const md = renderReport(canonical, offerings);
    expect(md).toContain('# GLM 6');
    expect(md).toContain('nano-gpt');
    expect(md).toContain('128000');
    expect(md).toContain('200000');
    expect(md).toContain('block');
    expect(md).toMatch(/freedom.*restricted/i);
  });
});
