// SPDX-License-Identifier: LGPL-3.0-only
// Emits a tool-call whose argumentsJson is invalid JSON (a reassembly bug) and
// reflects reasoning/content — should fail only the tool-call JSON check.
interface Delta {
  choices?: Array<{ delta?: { content?: string; reasoning?: string; tool_calls?: unknown[] } }>;
}
export const adapter = {
  buildRequest() {
    return { model: 'x', body: {} };
  },
  parseChunk(raw: unknown, state: unknown) {
    const d = (raw as Delta).choices?.[0]?.delta ?? {};
    const events: unknown[] = [];
    if (d.reasoning) events.push({ type: 'reasoning', text: d.reasoning });
    if (d.content) events.push({ type: 'token', text: d.content });
    if (d.tool_calls)
      events.push({ type: 'tool-call', toolCallId: 'c1', name: 'f', argumentsJson: '{not json' });
    return { events, state };
  },
  profile: {
    reasoning: { mode: 'fixed-on' },
    toolCalls: { supported: true, streaming: false, concurrentWithReasoning: false },
    vision: false,
    replayReasoning: true,
  },
};
