// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from 'bun:test';
import { parse as parseYaml } from 'yaml';
import type { BuiltOffering } from './model-file.js';
import { writeBuiltBlock } from './write-back.js';

const source = `# --- human-curated ---
canonical:
  id: glm-6        # keep this comment
  displayName: GLM 6
  family: glm
  requiredCaps: { tools: true, reasoning: true, vision: false }
  freedomOriented: true
  freedomNote: ""
offerings:
  - provider: nano-gpt
    upstreamSlug: zai-org/glm-6
    trust: { tee: false, zdr: false }
    freedomOrientedDeployment: false
    context: { recommended: 128000, max: 200000 }
`;

const built: BuiltOffering[] = [
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
];

describe('writeBuiltBlock', () => {
  it('adds the built block while preserving human content and comments', () => {
    const out = writeBuiltBlock(source, built);
    expect(out).toContain('keep this comment');
    const parsed = parseYaml(out) as { canonical: { id: string }; built: BuiltOffering[] };
    expect(parsed.canonical.id).toBe('glm-6');
    expect(parsed.built).toHaveLength(1);
    expect(parsed.built[0]?.adapterFile).toBe('glm-6.nano-gpt.adapter.ts');
  });

  it('replaces a previous built block on re-run (idempotent)', () => {
    const once = writeBuiltBlock(source, built);
    const twice = writeBuiltBlock(once, built);
    const parsed = parseYaml(twice) as { built: BuiltOffering[] };
    expect(parsed.built).toHaveLength(1);
  });
});
