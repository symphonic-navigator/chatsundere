// SPDX-License-Identifier: AGPL-3.0-only
import type { ToolDef, WireMessage } from '@chatsundere/llm-unified';
import { describe, expect, it, vi } from 'vitest';
import {
  type AgentLoopDeps,
  type AgentLoopStreamResult,
  runAgentLoop,
} from '../../src/lib/agent-loop.js';
import type { ToolResult } from '../../src/tools/types.js';

const sampleToolDefs: ToolDef[] = [
  {
    name: 'replace_current',
    description: 'Replace body',
    parameters: { type: 'object', properties: {} },
  },
];

function okResult(output: string, meta?: Record<string, unknown>): ToolResult {
  return { ok: true, output, error: null, meta };
}

function failResult(error: string): ToolResult {
  return { ok: false, output: '', error };
}

describe('runAgentLoop', () => {
  it('runs a tool call then a final answer; ledger records success and roundsUsed counts tool-capable streams', async () => {
    const exchangeSnapshots: Array<{ toolsLen: number; exchange: WireMessage[] }> = [];
    let streamN = 0;

    const streamOnce = vi.fn(
      async (exchange: WireMessage[], tools: ToolDef[]): Promise<AgentLoopStreamResult> => {
        exchangeSnapshots.push({ toolsLen: tools.length, exchange: structuredClone(exchange) });
        streamN += 1;
        if (streamN === 1) {
          return {
            text: '',
            toolCalls: [
              {
                id: 'call_1',
                name: 'replace_current',
                argumentsJson: JSON.stringify({ body: 'new', force: true }),
              },
            ],
          };
        }
        return { text: 'Updated the artefact.', toolCalls: [] };
      },
    );

    const dispatch = vi.fn(
      async (name: string): Promise<ToolResult> =>
        okResult(`replaced via ${name}`, {
          op: 'replace_current',
          targetId: 'art-1',
          resultingUpdatedAt: 1_700_000_000_000,
        }),
    );

    const result = await runAgentLoop({
      streamOnce,
      dispatch,
      toolDefs: sampleToolDefs,
      maxRounds: 4,
    });

    expect(result.finalText).toBe('Updated the artefact.');
    expect(result.stoppedByAbort).toBe(false);
    expect(result.roundLimitReached).toBe(false);
    // Two tool-capable streams: tool-call turn + final natural answer with tools still offered.
    expect(result.roundsUsed).toBe(2);
    expect(result.ledger).toHaveLength(1);
    expect(result.ledger[0]).toMatchObject({
      op: 'replace_current',
      targetId: 'art-1',
      success: true,
      resultingUpdatedAt: 1_700_000_000_000,
    });
    expect(result.ledger[0]?.error).toBeUndefined();
    expect(typeof result.ledger[0]?.at).toBe('number');

    expect(dispatch).toHaveBeenCalledWith(
      'replace_current',
      { body: 'new', force: true },
      undefined,
    );

    // First stream offered tools; second also (natural stop, not force).
    expect(exchangeSnapshots[0]?.toolsLen).toBe(1);
    expect(exchangeSnapshots[1]?.toolsLen).toBe(1);
    // Second stream sees assistant tool_calls + tool result on the exchange.
    const second = exchangeSnapshots[1]?.exchange ?? [];
    expect(second[0]).toMatchObject({
      role: 'assistant',
      tool_calls: [
        {
          id: 'call_1',
          type: 'function',
          function: { name: 'replace_current' },
        },
      ],
    });
    expect(second[1]).toMatchObject({
      role: 'tool',
      tool_call_id: 'call_1',
      content: 'replaced via replace_current',
    });
  });

  it('records dispatch failure in the ledger and continues to a final answer', async () => {
    let streamN = 0;
    const streamOnce = vi.fn(
      async (_exchange: WireMessage[], _tools: ToolDef[]): Promise<AgentLoopStreamResult> => {
        streamN += 1;
        if (streamN === 1) {
          return {
            text: 'trying…',
            toolCalls: [
              { id: 'c1', name: 'replace_current', argumentsJson: '{not-json' },
              {
                id: 'c2',
                name: 'read_current',
                argumentsJson: JSON.stringify({}),
              },
            ],
          };
        }
        return { text: 'Partial: read ok, replace failed.', toolCalls: [] };
      },
    );

    const dispatch = vi.fn(async (name: string): Promise<ToolResult> => {
      if (name === 'replace_current') return failResult('stale expectedUpdatedAt');
      return okResult('body here', { op: 'read_current', targetId: 'art-1' });
    });

    const result = await runAgentLoop({
      streamOnce,
      dispatch,
      toolDefs: sampleToolDefs,
      maxRounds: 3,
    });

    expect(result.finalText).toBe('Partial: read ok, replace failed.');
    expect(result.roundLimitReached).toBe(false);
    expect(result.ledger).toHaveLength(2);
    expect(result.ledger[0]).toMatchObject({
      op: 'replace_current',
      success: false,
      error: 'stale expectedUpdatedAt',
    });
    // Invalid JSON args → empty object passed to dispatch.
    expect(dispatch).toHaveBeenNthCalledWith(1, 'replace_current', {}, undefined);
    expect(result.ledger[1]).toMatchObject({
      op: 'read_current',
      targetId: 'art-1',
      success: true,
    });

    // Failed tool content is the error string.
    const exchangeAfterTools = streamOnce.mock.calls[1]?.[0] as WireMessage[];
    expect(
      exchangeAfterTools.find((m) => m.role === 'tool' && m.tool_call_id === 'c1'),
    ).toMatchObject({ content: 'stale expectedUpdatedAt' });
  });

  it('with maxRounds=0 forces a tools-free final pass and sets roundLimitReached', async () => {
    const streamOnce = vi.fn(
      async (_exchange: WireMessage[], tools: ToolDef[]): Promise<AgentLoopStreamResult> => {
        expect(tools).toEqual([]);
        return { text: 'Honest partial report.', toolCalls: [] };
      },
    );

    const result = await runAgentLoop({
      streamOnce,
      dispatch: vi.fn(),
      toolDefs: sampleToolDefs,
      maxRounds: 0,
      finalRoundNudge: 'Report what was done honestly.',
    });

    expect(result.finalText).toBe('Honest partial report.');
    expect(result.roundsUsed).toBe(0);
    expect(result.roundLimitReached).toBe(true);
    expect(result.stoppedByAbort).toBe(false);
    expect(result.ledger).toEqual([]);
    expect(streamOnce).toHaveBeenCalledTimes(1);

    const exchange = streamOnce.mock.calls[0]?.[0] as WireMessage[];
    expect(exchange).toContainEqual({
      role: 'user',
      content: 'Report what was done honestly.',
    });
  });

  it('after maxRounds tool rounds without natural stop, forces tools-free final stream', async () => {
    const toolsLens: number[] = [];
    let streamN = 0;

    const streamOnce = vi.fn(
      async (_exchange: WireMessage[], tools: ToolDef[]): Promise<AgentLoopStreamResult> => {
        toolsLens.push(tools.length);
        streamN += 1;
        // Always request a tool until forced final.
        return {
          text: '',
          toolCalls: [
            {
              id: `call_${streamN}`,
              name: 'read_current',
              argumentsJson: '{}',
            },
          ],
        };
      },
    );

    const dispatch = vi.fn(async (): Promise<ToolResult> => okResult('ok'));

    const result = await runAgentLoop({
      streamOnce,
      dispatch,
      toolDefs: sampleToolDefs,
      maxRounds: 1,
    });

    // One tool-capable round + one forced tools-free pass.
    expect(toolsLens).toEqual([1, 0]);
    expect(result.roundsUsed).toBe(1);
    expect(result.roundLimitReached).toBe(true);
    // Forced pass still returns whatever text the model emitted (here empty).
    expect(result.finalText).toBe('');
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(result.ledger).toHaveLength(1);
    // Default op is the tool name when meta omits op.
    expect(result.ledger[0]?.op).toBe('read_current');
    expect(result.ledger[0]?.success).toBe(true);
  });

  it('returns stoppedByAbort when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();

    const streamOnce = vi.fn();
    const dispatch = vi.fn();

    const result = await runAgentLoop({
      streamOnce,
      dispatch,
      toolDefs: sampleToolDefs,
      maxRounds: 4,
      signal: controller.signal,
    });

    expect(result.stoppedByAbort).toBe(true);
    expect(result.finalText).toBe('');
    expect(result.roundsUsed).toBe(0);
    expect(result.roundLimitReached).toBe(false);
    expect(result.ledger).toEqual([]);
    expect(streamOnce).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('stops mid-tool loop when the signal aborts between tool calls', async () => {
    const controller = new AbortController();
    const streamOnce = vi.fn(
      async (): Promise<AgentLoopStreamResult> => ({
        text: '',
        toolCalls: [
          { id: 'a', name: 'read_current', argumentsJson: '{}' },
          { id: 'b', name: 'replace_current', argumentsJson: '{}' },
        ],
      }),
    );

    const dispatch = vi.fn(async (name: string): Promise<ToolResult> => {
      if (name === 'read_current') {
        controller.abort();
        return okResult('body');
      }
      return okResult('should not run');
    });

    const result = await runAgentLoop({
      streamOnce,
      dispatch,
      toolDefs: sampleToolDefs,
      maxRounds: 4,
      signal: controller.signal,
    });

    expect(result.stoppedByAbort).toBe(true);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(result.ledger).toHaveLength(1);
    expect(result.ledger[0]?.op).toBe('read_current');
    // Only one tool-capable stream was started.
    expect(result.roundsUsed).toBe(1);
  });

  it('forwards onProgress after a stream completes', async () => {
    const onProgress = vi.fn();
    await runAgentLoop({
      streamOnce: async () => ({ text: 'hello world', toolCalls: [] }),
      dispatch: vi.fn(),
      toolDefs: sampleToolDefs,
      maxRounds: 2,
      onProgress,
    });
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({ charCount: 'hello world'.length }),
    );
  });
});
