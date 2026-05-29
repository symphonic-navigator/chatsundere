import { describe, expect, it } from 'bun:test';
import { resolve } from 'node:path';
import type { CapturedFixture } from './fixture-types.js';
import { loadAdapterInSandbox } from './sandbox-host.js';
import { validateAdapter } from './validate.js';

const baselinePath = resolve(import.meta.dir, '../adapters/nano-gpt-deepseek.baseline.sandbox.ts');

function sse(...deltas: object[]): string {
  return `${deltas.map((d) => `data: ${JSON.stringify(d)}`).join('\n\n')}\n\ndata: [DONE]\n\n`;
}

const toolFixture: CapturedFixture = {
  probeId: 'tool-call',
  dimension: 'tool-call',
  requestBody: {},
  status: 200,
  rawResponse: sse(
    {
      choices: [
        {
          delta: {
            tool_calls: [
              { index: 0, id: 'c1', function: { name: 'get_weather', arguments: '{"city":' } },
            ],
          },
        },
      ],
    },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"Wien"}' } }] } }] },
    { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
  ),
};

describe('validateAdapter', () => {
  it('passes when the candidate reproduces the baseline on the fixtures', async () => {
    const candidate = await loadAdapterInSandbox(baselinePath);
    const baseline = await loadAdapterInSandbox(baselinePath);
    const verdict = await validateAdapter({ candidate, baseline, fixtures: [toolFixture] });
    expect(verdict.passed).toBe(true);
    expect(verdict.failures).toHaveLength(0);
    candidate.dispose();
    baseline.dispose();
  });

  it('fails when the candidate profile contradicts the captured evidence', async () => {
    // The baseline adapter declares reasoning.kind = 'optional'. These fixtures
    // show reasoning-OFF still emitting reasoning, so the evidence says
    // 'always_on' — exactly the mismatch GLM shipped on the first live run.
    // Events are identical (candidate IS the baseline), so only the profile
    // check can catch this.
    const candidate = await loadAdapterInSandbox(baselinePath);
    const baseline = await loadAdapterInSandbox(baselinePath);
    const fixtures: CapturedFixture[] = [
      {
        probeId: 'on',
        dimension: 'reasoning-on',
        requestBody: {},
        status: 200,
        rawResponse: sse({ choices: [{ delta: { reasoning: 'thinking' } }] }),
      },
      {
        probeId: 'off',
        dimension: 'reasoning-off',
        requestBody: {},
        status: 200,
        rawResponse: sse({ choices: [{ delta: { reasoning: 'still here' } }] }),
      },
    ];
    const verdict = await validateAdapter({ candidate, baseline, fixtures });
    expect(verdict.passed).toBe(false);
    expect(verdict.failures.some((f) => f.includes('reasoning.kind'))).toBe(true);
    candidate.dispose();
    baseline.dispose();
  });

  it('does not check profile fields for dimensions the fixtures never probed', async () => {
    // Only a tool-call fixture is present, so reasoning.kind must NOT be
    // asserted (no reasoning probe ran) — absence of evidence is not evidence
    // of 'no_reasoning'. The baseline's 'optional' must survive.
    const candidate = await loadAdapterInSandbox(baselinePath);
    const baseline = await loadAdapterInSandbox(baselinePath);
    const verdict = await validateAdapter({ candidate, baseline, fixtures: [toolFixture] });
    expect(verdict.passed).toBe(true);
    candidate.dispose();
    baseline.dispose();
  });
});
