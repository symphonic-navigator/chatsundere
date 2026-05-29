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
});
