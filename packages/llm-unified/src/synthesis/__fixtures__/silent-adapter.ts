// SPDX-License-Identifier: LGPL-3.0-only
// Emits NO events regardless of input — should fail structural validation when
// the fixtures clearly contain reasoning/content/tool-calls.
export const adapter = {
  buildRequest() {
    return { model: 'x', body: {} };
  },
  parseChunk(_raw: unknown, state: unknown) {
    return { events: [], state };
  },
  profile: {
    reasoning: { mode: 'fixed-on' },
    toolCalls: { supported: false, streaming: false, concurrentWithReasoning: false },
    vision: false,
    replayReasoning: true,
  },
};
