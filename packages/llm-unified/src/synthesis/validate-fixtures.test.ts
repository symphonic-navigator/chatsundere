// SPDX-License-Identifier: LGPL-3.0-only
import { describe, expect, it } from 'bun:test';
import { resolve } from 'node:path';
import type { CapturedFixture } from './fixture-types.js';
import { loadAdapterInSandbox } from './sandbox-host.js';
import { validateAgainstFixtures } from './validate-fixtures.js';

const baselinePath = resolve(import.meta.dir, '../adapters/nano-gpt-deepseek.baseline.sandbox.ts');

function sse(...deltas: object[]): string {
  return `${deltas.map((d) => `data: ${JSON.stringify(d)}`).join('\n\n')}\n\ndata: [DONE]\n\n`;
}

// A reasoning-on fixture (reasoning present) and a tool-call fixture (block) that
// the DeepSeek baseline handles correctly.
const fixtures: CapturedFixture[] = [
  {
    probeId: 'reasoning-on',
    dimension: 'reasoning-on',
    requestBody: {},
    status: 200,
    rawResponse: sse(
      { choices: [{ delta: { reasoning: 'thinking' } }] },
      { choices: [{ delta: { content: 'hi' } }] },
    ),
  },
  {
    probeId: 'tool-call',
    dimension: 'tool-call',
    requestBody: {},
    status: 200,
    rawResponse: sse(
      {
        choices: [
          {
            delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'f', arguments: '' } }] },
          },
        ],
      },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"a":1}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    ),
  },
];

describe('validateAgainstFixtures', () => {
  it('passes a correct adapter that reflects the evidence', async () => {
    const candidate = await loadAdapterInSandbox(baselinePath);
    const verdict = await validateAgainstFixtures({ candidate, fixtures });
    expect(verdict.passed).toBe(true);
    candidate.dispose();
  });

  it('fails an adapter that emits no events', async () => {
    const candidate = await loadAdapterInSandbox(
      resolve(import.meta.dir, '__fixtures__/silent-adapter.ts'),
    );
    const verdict = await validateAgainstFixtures({ candidate, fixtures });
    expect(verdict.passed).toBe(false);
    expect(verdict.failures.some((f) => /reasoning|token|tool call/i.test(f))).toBe(true);
    candidate.dispose();
  });

  it('fails an adapter whose tool-call argumentsJson is invalid', async () => {
    const candidate = await loadAdapterInSandbox(
      resolve(import.meta.dir, '__fixtures__/bad-toolcall-adapter.ts'),
    );
    const verdict = await validateAgainstFixtures({ candidate, fixtures });
    expect(verdict.passed).toBe(false);
    expect(verdict.failures.some((f) => /valid JSON/i.test(f))).toBe(true);
    candidate.dispose();
  });
});
