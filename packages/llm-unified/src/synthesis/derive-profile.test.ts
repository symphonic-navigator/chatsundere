import { describe, expect, it } from 'bun:test';
import { deriveObservedProfile } from './derive-profile.js';
import type { CapturedFixture } from './fixture-types.js';

function sse(...deltas: object[]): string {
  return `${deltas.map((d) => `data: ${JSON.stringify(d)}`).join('\n\n')}\n\ndata: [DONE]\n\n`;
}

describe('deriveObservedProfile', () => {
  it('flags always_on when reasoning-off still emits reasoning', () => {
    const fixtures: CapturedFixture[] = [
      {
        probeId: 'off',
        dimension: 'reasoning-off',
        requestBody: {},
        status: 200,
        rawResponse: sse({ choices: [{ delta: { reasoning: 'still thinking' } }] }),
      },
    ];
    expect(deriveObservedProfile(fixtures).reasoningKind).toBe('always_on');
  });

  it('reports streaming tool calls when arguments arrive across >1 delta', () => {
    const fixtures: CapturedFixture[] = [
      {
        probeId: 'tc',
        dimension: 'tool-call',
        requestBody: {},
        status: 200,
        rawResponse: sse(
          {
            choices: [
              {
                delta: {
                  tool_calls: [{ index: 0, id: 'c1', function: { name: 'f', arguments: '{"a":' } }],
                },
              },
            ],
          },
          { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '1}' } }] } }] },
        ),
      },
    ];
    const p = deriveObservedProfile(fixtures);
    expect(p.toolCallsStreaming).toBe(true);
    expect(p.toolCallsSupported).toBe(true);
  });

  it('treats a block tool call (empty initialiser + one full-args delta) as NOT streaming', () => {
    const fixtures: CapturedFixture[] = [
      {
        probeId: 'tc-block',
        dimension: 'tool-call',
        requestBody: {},
        status: 200,
        rawResponse: sse(
          {
            choices: [
              {
                delta: {
                  tool_calls: [{ index: 0, id: 'c1', function: { name: 'f', arguments: '' } }],
                },
              },
            ],
          },
          {
            choices: [
              { delta: { tool_calls: [{ index: 0, function: { arguments: '{"a":1}' } }] } },
            ],
          },
        ),
      },
    ];
    const p = deriveObservedProfile(fixtures);
    expect(p.toolCallsSupported).toBe(true);
    expect(p.toolCallsStreaming).toBe(false);
  });

  it('detects concurrency when one response has both reasoning and a tool call', () => {
    const fixtures: CapturedFixture[] = [
      {
        probeId: 'rt',
        dimension: 'reasoning-and-tools',
        requestBody: {},
        status: 200,
        rawResponse: sse(
          { choices: [{ delta: { reasoning: 'hmm' } }] },
          {
            choices: [
              {
                delta: {
                  tool_calls: [{ index: 0, id: 'c1', function: { name: 'f', arguments: '{}' } }],
                },
              },
            ],
          },
        ),
      },
    ];
    expect(deriveObservedProfile(fixtures).concurrentWithReasoning).toBe(true);
  });

  it('records effort-max acceptance from the status code', () => {
    const fixtures: CapturedFixture[] = [
      {
        probeId: 'max',
        dimension: 'effort-max',
        requestBody: {},
        status: 400,
        rawResponse: '{"error":"unknown effort"}',
      },
    ];
    expect(deriveObservedProfile(fixtures).effortMaxAccepted).toBe(false);
  });
});
