// SPDX-License-Identifier: AGPL-3.0-only
import 'fake-indexeddb/auto';
import * as llm from '@chatsundere/llm-unified';
import {
  TIME_STAMP_INSTRUCTION,
  type WireContentPart,
  type WireMessage,
  getOffering,
} from '@chatsundere/llm-unified';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import { type ReactNode, createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nanoGpt } from '../../../../packages/llm-unified/src/providers/nano-gpt.js';
import {
  type MessageRow,
  type PersonaRow,
  _resetClientDataDbForTests,
  getClientDataDb,
  openClientDataDb,
} from '../../src/boot/client-data-db.js';
import { useBranchChat } from '../../src/data/chats.js';
import { type StartStreamArgs, runStreamEngine } from '../../src/lib/stream-engine.js';
import { sentAtOf } from '../../src/lib/time-awareness.js';
import type { ReplayContext } from '../../src/lib/tool-replay.js';

// The prompt-cache contract (time-export-motion spec, "The test"): every wire
// message of turn N is byte-identical at the same index of turn N+1, whatever
// the runtime's zone or language, after a regenerate, and in a branched copy.

// biome-ignore lint/style/noNonNullAssertion: test fixture — this slug is guaranteed to exist in the catalogue
const offering = getOffering('nano-gpt', 'deepseek/deepseek-v4-flash')!;

const T0 = Date.parse('2026-11-18T20:14:00Z');
const MIN = 60_000;

const persona: PersonaRow = {
  id: 'p1',
  name: 'A',
  tagline: '',
  colour: '#fff',
  font: 'serif',
  instructions: 'You are A.',
  canonicalId: null,
  providerId: 'pr1',
  modelId: offering.upstreamSlug,
  mindspaceId: null,
  aboutMeOverride: null,
  textureOverride: null,
  temperature: 0.5,
  adultPersona: false,
  chatsundereTonality: true,
  contextWindow: null,
  libraryIds: [],
  askExpertDefault: false,
  mcpOverrides: {},
  roleplay: false,
  narration: 'first',
  greetingEnabled: false,
  greetingInstructions: '',
  voice: null,
  narratorVoice: null,
  createdAt: 1,
  updatedAt: 1,
};

function row(
  partial: Partial<MessageRow> & Pick<MessageRow, 'id' | 'role' | 'createdAt'>,
): MessageRow {
  return {
    chatId: 'c1',
    contentBlocks: [{ type: 'text', text: `${partial.id} text` }],
    updatedAt: partial.createdAt,
    bookmarked: false,
    streamingState: 'complete',
    ...partial,
  };
}

/** A seeded chat with two real exchanges; the second user turn is the active one at turn N. */
const seeded: MessageRow[] = [
  row({ id: 'greet', role: 'persona', createdAt: T0, kind: 'seed', seedRole: 'greeting' }),
  row({ id: 'sbu', role: 'user', createdAt: T0 + 1, kind: 'seed', seedRole: 'body' }),
  row({ id: 'sbp', role: 'persona', createdAt: T0 + 2, kind: 'seed', seedRole: 'body' }),
  row({ id: 'u1', role: 'user', createdAt: T0 + MIN, utcOffsetMinutes: 60 }),
  row({ id: 'a1', role: 'persona', createdAt: T0 + 2 * MIN }),
];
const u2 = row({ id: 'u2', role: 'user', createdAt: T0 + 3 * 24 * 60 * MIN, utcOffsetMinutes: 60 });
const a2 = row({ id: 'a2', role: 'persona', createdAt: u2.createdAt + MIN });
const u3 = row({ id: 'u3', role: 'user', createdAt: u2.createdAt + 5 * MIN, utcOffsetMinutes: 60 });

function replayCtx(): ReplayContext {
  return {
    pillsById: new Map(),
    userContentById: new Map(),
    policy: { toolsSupported: true, orphanReplay: false, activeToolNames: new Set() },
  };
}

function args(over: Partial<StartStreamArgs>): StartStreamArgs {
  return {
    chat: {
      id: 'c1',
      personaId: 'p1',
      title: null,
      resolvedMindspaceId: 'm1',
      createdAt: 1,
      updatedAt: 1,
      lastMessageAt: 1,
      bookmarkedMessageCount: 0,
      draftInput: '',
      libraryIds: [],
    },
    persona,
    provider: nanoGpt,
    providerConfig: { baseUrl: nanoGpt.baseUrl, routing: { kind: 'direct' } },
    apiKey: 'k',
    offering,
    priorMessages: [],
    userMessageText: 'hi',
    reasoning: { kind: 'on' },
    globalInstructions: '',
    globalAboutMe: '',
    screenEffectsEnabled: false,
    replay: replayCtx(),
    signal: new AbortController().signal,
    onChunk: vi.fn(),
    ...over,
  };
}

/** Run the engine with the transport stubbed and return the wire it would send. */
async function wireOf(a: StartStreamArgs): Promise<WireMessage[]> {
  let captured: WireMessage[] = [];
  vi.spyOn(llm, 'streamCompletion').mockImplementation(async function* (x) {
    captured = (x as { messages: WireMessage[] }).messages;
    yield { type: 'finish', reason: 'stop' };
  });
  await runStreamEngine(a);
  vi.mocked(llm.streamCompletion).mockRestore();
  return captured;
}

function textOf(m: MessageRow): string {
  const b = m.contentBlocks[0];
  return b && b.type === 'text' ? b.text : '';
}

/** Turn N: `u2` is the active turn. */
function turnN(over: Partial<StartStreamArgs> = {}): Promise<WireMessage[]> {
  return wireOf(
    args({
      priorMessages: seeded,
      userMessageText: textOf(u2),
      userMessageAt: sentAtOf(u2),
      ...over,
    }),
  );
}

/** Turn N+1: `u2` and its reply are history, `u3` is active. */
function turnN1(over: Partial<StartStreamArgs> = {}): Promise<WireMessage[]> {
  return wireOf(
    args({
      priorMessages: [...seeded, u2, a2],
      userMessageText: textOf(u3),
      userMessageAt: sentAtOf(u3),
      ...over,
    }),
  );
}

function expectPrefixIdentical(n: WireMessage[], n1: WireMessage[]): void {
  expect(n1.length).toBeGreaterThan(n.length);
  n.forEach((m, i) => {
    expect(JSON.stringify(n1[i])).toBe(JSON.stringify(m));
  });
}

const realTz = process.env.TZ;
afterEach(async () => {
  process.env.TZ = realTz;
  vi.restoreAllMocks();
  await _resetClientDataDbForTests();
});

describe('stamped wire — prompt-cache consistency', () => {
  it('keeps every message of turn N byte-identical in turn N+1', async () => {
    expectPrefixIdentical(await turnN(), await turnN1());
  });

  it('is unaffected by the runtime time zone changing between turns', async () => {
    process.env.TZ = 'Europe/Berlin';
    const n = await turnN();
    process.env.TZ = 'America/Los_Angeles';
    const n1 = await turnN1();
    expectPrefixIdentical(n, n1);
  });

  it('is unaffected by the browser language changing between turns', async () => {
    const lang = vi.spyOn(window.navigator, 'language', 'get').mockReturnValue('de-DE');
    const n = await turnN();
    lang.mockReturnValue('ja-JP');
    const n1 = await turnN1();
    expectPrefixIdentical(n, n1);
  });

  it('re-sends the identical request on a regenerate', async () => {
    const first = await turnN();
    process.env.TZ = 'Asia/Kathmandu';
    // Regenerate rebuilds the turn from the stored user row.
    const again = await turnN({ userMessageAt: sentAtOf(u2) });
    expect(JSON.stringify(again)).toBe(JSON.stringify(first));
  });

  it('gives a branched copy the source chat’s prefix byte for byte', async () => {
    await openClientDataDb();
    const db = getClientDataDb();
    await db.chats.add({
      id: 'c1',
      personaId: 'p1',
      title: 'Src',
      resolvedMindspaceId: 'm1',
      createdAt: 1,
      updatedAt: 1,
      lastMessageAt: a2.createdAt,
      bookmarkedMessageCount: 0,
      draftInput: '',
      libraryIds: [],
    });
    await db.messages.bulkAdd([...seeded, u2, a2]);
    const qc = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(QueryClientProvider, { client: qc }, children);
    const { result } = renderHook(() => useBranchChat(), { wrapper });
    await waitFor(() => expect(result.current.mutateAsync).toBeDefined());
    const branchId = await result.current.mutateAsync({
      sourceChatId: 'c1',
      branchPointMessageId: 'a2',
      title: 'Branch',
    });
    const branched = await db.messages.where('chatId').equals(branchId).sortBy('createdAt');

    const source = await turnN1();
    const copy = await turnN1({ priorMessages: branched });
    expect(JSON.stringify(copy)).toBe(JSON.stringify(source));
  });
});

describe('stamped wire — content', () => {
  it('stamps every real user turn, prior and active, and nothing else', async () => {
    const wire = await turnN1();
    const users = wire.filter((m) => m.role === 'user');
    expect(users.map((m) => m.content)).toEqual([
      'sbu text',
      '<sent>Wed 18 Nov 2026, 21:15</sent>\nu1 text',
      '<sent>Sat 21 Nov 2026, 21:14</sent>\nu2 text',
      '<sent>Sat 21 Nov 2026, 21:19</sent>\nu3 text',
    ]);
    for (const m of wire.filter((x) => x.role === 'assistant')) {
      expect(JSON.stringify(m)).not.toContain('<sent');
    }
  });

  it('appends the static time segment to the system prompt', async () => {
    const [sys] = await turnN1();
    expect(typeof sys?.content === 'string' && sys.content.endsWith(TIME_STAMP_INSTRUCTION)).toBe(
      true,
    );
  });

  it('leads a multimodal active turn with the stamp as its own text part', async () => {
    const parts: WireContentPart[] = [
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AA' } },
      { type: 'text', text: 'look' },
    ];
    const wire = await turnN({ userMessageText: parts });
    expect(wire[wire.length - 1]?.content).toEqual([
      { type: 'text', text: '<sent>Sat 21 Nov 2026, 21:14</sent>\n' },
      ...parts,
    ]);
  });

  it('stamps a replayed multimodal turn the same way', async () => {
    const replay = replayCtx();
    const img: WireContentPart = { type: 'image_url', image_url: { url: 'data:x' } };
    replay.userContentById = new Map([['u1', [img, { type: 'text', text: 'u1 text' }]]]);
    const wire = await turnN({ replay });
    const u1Wire = wire.find(
      (m) => Array.isArray(m.content) && m.content.some((p) => p.type === 'image_url'),
    );
    expect(u1Wire?.content).toEqual([
      { type: 'text', text: '<sent>Wed 18 Nov 2026, 21:15</sent>\n' },
      img,
      { type: 'text', text: 'u1 text' },
    ]);
  });

  it('renders a pre-0.5.0 row with the device offset for its own instant', async () => {
    process.env.TZ = 'America/New_York';
    const legacy = row({ id: 'old', role: 'user', createdAt: T0 });
    const wire = await turnN({
      priorMessages: [legacy, row({ id: 'r', role: 'persona', createdAt: T0 + 1 })],
    });
    expect(wire[1]?.content).toBe('<sent>Wed 18 Nov 2026, 15:14</sent>\nold text');
  });

  for (const [label, p] of [
    ['explicitly off', { ...persona, timeAwareness: false }],
    ['a roleplay persona with the switch unset', { ...persona, roleplay: true }],
  ] as const) {
    it(`sends no stamp and no segment when ${label}`, async () => {
      const wire = await turnN1({ persona: p });
      expect(JSON.stringify(wire)).not.toContain('<sent');
      expect(JSON.stringify(wire)).not.toContain('timestamp');
    });
  }

  it('sends stamps for a roleplay persona whose owner turned time on', async () => {
    const wire = await turnN1({ persona: { ...persona, roleplay: true, timeAwareness: true } });
    expect(JSON.stringify(wire)).toContain('<sent>');
  });
});

describe('opener (greeting job)', () => {
  const openerAt = { createdAt: Date.parse('2026-11-21T08:02:00Z'), utcOffsetMinutes: 60 };

  it('dates the opener and names the time away when the switch is on', async () => {
    const wire = await wireOf(
      args({
        job: 'greeting',
        openerAt,
        persona: { ...persona, lastInteractionAt: openerAt.createdAt - 2 * 24 * 60 * MIN },
      }),
    );
    const sys = wire[0]?.content as string;
    expect(sys).toContain(
      "It is Saturday, 21 November 2026, 09:02 in the user's local time. They last talked with you 2 days ago.",
    );
    expect(sys).not.toContain(TIME_STAMP_INSTRUCTION);
    expect(JSON.stringify(wire)).not.toContain('<sent');
  });

  // The Dexie v28 backfill set lastInteractionAt = createdAt for personas with
  // no chats; such a value records no conversation and must not read as one.
  for (const [label, last] of [
    ['equal to the persona creation', openerAt.createdAt - 30 * 24 * 60 * MIN],
    ['earlier than the persona creation', openerAt.createdAt - 31 * 24 * 60 * MIN],
  ] as const) {
    it(`names no time away when lastInteractionAt is ${label}`, async () => {
      const wire = await wireOf(
        args({
          job: 'greeting',
          openerAt,
          persona: {
            ...persona,
            timeAwareness: true,
            createdAt: openerAt.createdAt - 30 * 24 * 60 * MIN,
            lastInteractionAt: last,
          },
        }),
      );
      const sys = wire[0]?.content as string;
      expect(sys).toContain("It is Saturday, 21 November 2026, 09:02 in the user's local time.");
      expect(sys).not.toContain('last talked');
    });
  }

  it('carries no date when the switch is off', async () => {
    const wire = await wireOf(
      args({ job: 'greeting', openerAt, persona: { ...persona, roleplay: true } }),
    );
    expect(wire[0]?.content).not.toContain("in the user's local time");
  });
});
