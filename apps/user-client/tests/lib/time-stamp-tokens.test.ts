// SPDX-License-Identifier: AGPL-3.0-only
import { type BuildPromptInputs, buildPrompt } from '@chatsundere/llm-unified';
import { describe, expect, it } from 'vitest';
import type { AttachmentRow, MessageRow } from '../../src/boot/client-data-db.js';
import { isContextMessage } from '../../src/lib/content-blocks.js';
import { wireTokens } from '../../src/lib/context-window.js';
import { buildEngineWireMessages } from '../../src/lib/stream-engine.js';
import { sentAtOf, userTurnStamp } from '../../src/lib/time-awareness.js';
import { estimateTokens } from '../../src/lib/token-estimator.js';
import { estimateReplayTokens } from '../../src/lib/tool-replay.js';

// The chat page's gauge and the overflow failsafe count with estimateReplayTokens;
// with time on they must count the stamps and the segment the wire carries.

const T0 = Date.parse('2026-11-18T20:14:00Z');

function row(id: string, role: MessageRow['role'], at: number, extra: Partial<MessageRow> = {}) {
  return {
    id,
    chatId: 'c1',
    role,
    contentBlocks: [{ type: 'text' as const, text: `${id} says something of a certain length` }],
    createdAt: at,
    updatedAt: at,
    bookmarked: false,
    streamingState: 'complete' as const,
    ...extra,
  };
}

const chat: MessageRow[] = [
  row('greet', 'persona', T0, { kind: 'seed', seedRole: 'greeting' }),
  row('sbu', 'user', T0 + 1, { kind: 'seed', seedRole: 'body' }),
  row('sbp', 'persona', T0 + 2, { kind: 'seed', seedRole: 'body' }),
  row('u1', 'user', T0 + 60_000, { utcOffsetMinutes: 60 }),
  row('a1', 'persona', T0 + 120_000),
  row('u2', 'user', T0 + 9 * 86_400_000, { utcOffsetMinutes: -300 }),
];

const inputs: BuildPromptInputs = {
  tonalityEnabled: true,
  nsfwEnabled: false,
  globalInstructions: '',
  personaInstructions: 'You are A.',
  aboutMe: '',
  projectInstructions: '',
  memoryContext: '',
  toolsInstruction: '',
  modelInstructions: '',
  screenEffectsEnabled: false,
  time: { mode: 'chat' },
};

describe('stamped token accounting', () => {
  it('the gauge estimate equals the wire tokens of the built messages with time on', () => {
    const sys = buildPrompt(inputs, 'chat');
    const gauge =
      estimateTokens(sys) +
      chat
        .filter(isContextMessage)
        .reduce((s, m) => s + estimateReplayTokens(m, new Map(), undefined, true), 0);

    const active = chat[chat.length - 1] as MessageRow;
    const wire = buildEngineWireMessages(
      sys,
      chat.slice(0, -1),
      'u2 says something of a certain length',
      [],
      undefined,
      { activeTurn: sentAtOf(active) },
    );
    expect(JSON.stringify(wire)).toContain('<sent>');
    expect(gauge).toBe(wire.reduce((s, m) => s + wireTokens(m), 0));
  });

  it('counts the stamp part of a multimodal turn with its trailing newline', () => {
    const u1 = chat[3] as MessageRow;
    const img = {
      id: 'img1',
      chatId: 'c1',
      messageId: 'u1',
      origin: 'upload',
      kind: 'image',
      fileName: 'a.jpg',
      mime: 'image/jpeg',
      order: 0,
      state: 'active',
      createdAt: u1.createdAt,
      updatedAt: u1.createdAt,
    } satisfies AttachmentRow;
    const byMessage = new Map([['u1', [img]]]);
    const stamp = userTurnStamp(u1) as string;
    expect(estimateReplayTokens(u1, new Map(), byMessage, true)).toBe(
      estimateReplayTokens(u1, new Map(), byMessage, false) + estimateTokens(`${stamp}\n`),
    );
  });

  it('counts nothing extra when the flag is off', () => {
    const u1 = chat[3] as MessageRow;
    expect(estimateReplayTokens(u1, new Map(), undefined, false)).toBe(
      estimateReplayTokens(u1, new Map()),
    );
    expect(estimateReplayTokens(u1, new Map(), undefined, true)).toBeGreaterThan(
      estimateReplayTokens(u1, new Map()),
    );
  });
});
