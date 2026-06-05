import { describe, expect, it } from 'vitest';
import type { PillRow } from '../../src/boot/client-data-db.js';
import type { StreamEngineResult } from '../../src/lib/stream-engine.js';
import { type ToolLoopDeps, runToolLoop } from '../../src/lib/tool-loop.js';

function toolCallPill(id: string, name: string, argumentsJson: string): PillRow {
  return {
    id,
    messageId: '',
    kind: 'tool-call',
    positionHint: 'inline',
    status: 'pending',
    payload: { name, argumentsJson, toolCallId: id },
    createdAt: 0,
  };
}

function textResult(text: string): StreamEngineResult {
  return { finalContentBlocks: [{ type: 'text', text }], pillRows: [], finishReason: 'stop' };
}

describe('runToolLoop', () => {
  it('passes through a single round with no tool calls', async () => {
    const calls: number[] = [];
    const deps: ToolLoopDeps = {
      toolDefs: [{ name: 'calculate_js', description: '', parameters: {} }],
      maxRounds: 5,
      streamOnce: async () => {
        calls.push(1);
        return textResult('plain answer');
      },
      dispatch: async () => ({ ok: true, output: '', error: null }),
    };
    const result = await runToolLoop(deps);
    expect(calls.length).toBe(1);
    expect(result.finalContentBlocks).toEqual([{ type: 'text', text: 'plain answer' }]);
  });

  it('executes a tool call, feeds the result back, and re-streams to an answer', async () => {
    const exchanges: number[] = [];
    let round = 0;
    const deps: ToolLoopDeps = {
      toolDefs: [{ name: 'calculate_js', description: '', parameters: {} }],
      maxRounds: 5,
      streamOnce: async (toolExchange, tools) => {
        exchanges.push(toolExchange.length);
        if (round++ === 0) {
          expect(tools.length).toBe(1); // tools offered on round 0
          return {
            finalContentBlocks: [{ type: 'pill', pillId: 'p1' }],
            pillRows: [toolCallPill('p1', 'calculate_js', '{"code":"2+2"}')],
            finishReason: 'tool_calls',
          };
        }
        return textResult('The answer is 4.');
      },
      dispatch: async (name, args) => {
        expect(name).toBe('calculate_js');
        expect(args).toEqual({ code: '2+2' });
        return { ok: true, output: '4', error: null };
      },
    };
    const result = await runToolLoop(deps);
    expect(exchanges).toEqual([0, 2]); // round 1 sees assistant(tool_calls) + tool result
    expect(result.finalContentBlocks).toEqual([
      { type: 'pill', pillId: 'p1' },
      { type: 'text', text: 'The answer is 4.' },
    ]);
    const pill = result.pillRows[0];
    expect(pill?.status).toBe('completed');
    expect((pill?.payload as { result?: string }).result).toBe('4');
  });

  it('marks a failed tool call and still feeds the error back', async () => {
    let round = 0;
    const deps: ToolLoopDeps = {
      toolDefs: [{ name: 'calculate_js', description: '', parameters: {} }],
      maxRounds: 5,
      streamOnce: async () =>
        round++ === 0
          ? {
              finalContentBlocks: [{ type: 'pill', pillId: 'p1' }],
              pillRows: [toolCallPill('p1', 'calculate_js', 'not json')],
              finishReason: 'tool_calls',
            }
          : textResult('Recovered.'),
      dispatch: async () => ({
        ok: false,
        output: 'ReferenceError: x',
        error: 'ReferenceError: x',
      }),
    };
    const result = await runToolLoop(deps);
    expect(result.pillRows[0]?.status).toBe('failed');
  });

  it('forces a tools-less final round after maxRounds tool rounds', async () => {
    const toolsSeen: number[] = [];
    const deps: ToolLoopDeps = {
      toolDefs: [{ name: 'calculate_js', description: '', parameters: {} }],
      maxRounds: 2,
      streamOnce: async (_exchange, tools) => {
        toolsSeen.push(tools.length);
        // Always wants to call again.
        return {
          finalContentBlocks: [{ type: 'pill', pillId: `p${toolsSeen.length}` }],
          pillRows: [toolCallPill(`p${toolsSeen.length}`, 'calculate_js', '{"code":"1"}')],
          finishReason: 'tool_calls',
        };
      },
      dispatch: async () => ({ ok: true, output: '1', error: null }),
    };
    await runToolLoop(deps);
    // rounds 0,1 offer the tool; round 2 (>= maxRounds) forces no tools.
    expect(toolsSeen).toEqual([1, 1, 0]);
  });

  it('executes multiple tool calls in one round and appends one assistant + N tool messages', async () => {
    const exchanges: number[] = [];
    let round = 0;
    const dispatched: string[] = [];
    const deps: ToolLoopDeps = {
      toolDefs: [{ name: 'calculate_js', description: '', parameters: {} }],
      maxRounds: 5,
      streamOnce: async (toolExchange) => {
        exchanges.push(toolExchange.length);
        if (round++ === 0) {
          return {
            finalContentBlocks: [
              { type: 'pill', pillId: 'p1' },
              { type: 'pill', pillId: 'p2' },
            ],
            pillRows: [
              toolCallPill('p1', 'calculate_js', '{"code":"1+1"}'),
              toolCallPill('p2', 'calculate_js', '{"code":"2+2"}'),
            ],
            finishReason: 'tool_calls',
          };
        }
        return textResult('done');
      },
      dispatch: async (name, args) => {
        dispatched.push(String((args as { code?: string }).code));
        return { ok: true, output: '42', error: null };
      },
    };
    const result = await runToolLoop(deps);
    // round 0 sees an empty exchange; round 1 sees 1 assistant + 2 tool = 3 messages.
    expect(exchanges).toEqual([0, 3]);
    expect(dispatched).toEqual(['1+1', '2+2']);
    expect(result.pillRows.map((p) => p.status)).toEqual(['completed', 'completed']);
  });

  it('feeds the error string into the tool message content on failure', async () => {
    let round = 0;
    let secondRoundExchange: { role: string; content: unknown; tool_call_id?: string }[] = [];
    const deps: ToolLoopDeps = {
      toolDefs: [{ name: 'calculate_js', description: '', parameters: {} }],
      maxRounds: 5,
      streamOnce: async (toolExchange) => {
        if (round++ === 0) {
          return {
            finalContentBlocks: [{ type: 'pill', pillId: 'p1' }],
            pillRows: [toolCallPill('p1', 'calculate_js', '{"code":"boom"}')],
            finishReason: 'tool_calls',
          };
        }
        secondRoundExchange = toolExchange as typeof secondRoundExchange;
        return textResult('recovered');
      },
      dispatch: async () => ({
        ok: false,
        output: 'partial',
        error: 'ReferenceError: boom is not defined',
      }),
    };
    await runToolLoop(deps);
    const toolMsg = secondRoundExchange.find((m) => m.role === 'tool');
    expect(toolMsg?.tool_call_id).toBe('p1');
    expect(toolMsg?.content).toBe('ReferenceError: boom is not defined');
  });
});
