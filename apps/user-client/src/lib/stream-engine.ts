// SPDX-License-Identifier: AGPL-3.0-only

import {
  type Offering,
  type PromptTimeInput,
  type ProviderConfig,
  type ProviderDefinition,
  type StreamChunk,
  type StreamDiagnosticsSink,
  type ToolDef,
  type WireContentPart,
  type WireMessage,
  buildPrompt,
  formatRetryEvent,
  formatSentStamp,
  offeringToTarget,
  resolveModelInstructions,
  streamCompletion,
} from '@chatsundere/llm-unified';
import { uuidv7 } from 'uuidv7';
import type {
  ChatRow,
  ContentBlock,
  MessageRow,
  PersonaRow,
  PillRow,
} from '../boot/client-data-db.js';
import { flattenAnswerText, isContextMessage } from './content-blocks.js';
import { resolveContextWindow, truncateToWindow, wireTokens } from './context-window.js';
import { type ReasoningState, resolveReasoningBodyExtras } from './reasoning-resolver.js';
import {
  type SentAt,
  prependStamp,
  resolveTimeAwareness,
  userTurnStamp,
} from './time-awareness.js';
import { type ReplayContext, replayHistory } from './tool-replay.js';

export interface StartStreamArgs {
  chat: ChatRow;
  persona: PersonaRow;
  provider: ProviderDefinition;
  providerConfig: ProviderConfig;
  apiKey: string;
  offering: Offering;
  priorMessages: MessageRow[];
  /** The active user turn content. Pass a plain string for text-only turns or a
   *  `WireContentPart[]` for multimodal turns (images + text). */
  userMessageText: string | WireContentPart[];
  reasoning: ReasoningState;
  globalInstructions: string;
  globalAboutMe: string;
  /** Global toggle — injects the screen-effects guidance and gates the overlay. */
  screenEffectsEnabled: boolean;
  /** Joined tool system-prompt instructions for the Band-3 tools segment. */
  toolsInstruction?: string;
  /** Band-2 phrase-triggered lore text (chat only); '' when nothing fired. */
  loreContext?: string;
  /** Band-2 knowledge-libraries awareness text (chat only); '' when none. */
  knowledgeLibrariesContext?: string;
  /** Pre-assembled <usermemory> block, or '' when memory is off/empty. */
  memoryContext?: string;
  /** Canonical tool definitions to offer the model (empty = none). */
  tools?: ToolDef[];
  /** Accumulated assistant(tool_calls) / tool messages from prior loop rounds,
   *  appended after the active user turn. */
  toolExchange?: WireMessage[];
  /** Pills + policy for replaying prior tool rounds structurally (spec §3/§5).
   *  Absent ⇒ history replays as text only (opener, background jobs). */
  replay?: ReplayContext;
  /** Prompt job — 'greeting' builds the opener prompt (Band 1 + About Me, no
   *  lore/knowledge/tools). Default 'chat'. */
  job?: 'chat' | 'greeting';
  /** When the active user turn was sent, from its stored row: its stamp is
   *  rendered from this, never from the clock, so a regenerate or edit-replace
   *  sends the same bytes. Absent ⇒ the active turn carries no stamp (a seed
   *  body turn, or a job with no real user turn). */
  userMessageAt?: SentAt;
  /** "Now" for the opener (greeting job), when the persona knows the time. */
  openerAt?: SentAt;
  signal: AbortSignal;
  onChunk: (chunk: StreamChunk) => void;
  /** Optional diagnostic capture sink, forwarded to the streaming transport. */
  onDiagnostics?: StreamDiagnosticsSink;
}

export interface StreamEngineResult {
  finalContentBlocks: ContentBlock[];
  pillRows: PillRow[];
  finishReason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'unknown';
  usedTokens: number;
}

/** The opener's plaintext for the system-prompt echo. Empty unless this is a
 *  chat job and a kind:'opener' message — or a seed greeting (kind:'seed',
 *  seedRole:'greeting') — exists in history. Neither is ever on the wire, so
 *  the echo is the model's only continuity with it. */
export function resolveOpenerContext(
  priorMessages: MessageRow[],
  job: 'chat' | 'greeting',
): string {
  if (job !== 'chat') return '';
  const found = priorMessages.find(
    (m) => m.kind === 'opener' || (m.kind === 'seed' && m.seedRole === 'greeting'),
  );
  return found ? flattenAnswerText(found.contentBlocks) : '';
}

/**
 * Orchestrate a single chat-turn against the upstream. Pure (apart from the
 * onChunk callback) — does NOT touch Dexie. Caller (stream-manager) is
 * responsible for persistence.
 */
export async function runStreamEngine(args: StartStreamArgs): Promise<StreamEngineResult> {
  const job = args.job ?? 'chat';
  const timeOn = resolveTimeAwareness(args.persona);
  const aboutMe = args.persona.aboutMeOverride?.trim()
    ? args.persona.aboutMeOverride
    : args.globalAboutMe;
  const systemPrompt = buildPrompt(
    {
      tonalityEnabled: args.persona.chatsundereTonality,
      nsfwEnabled: args.persona.adultPersona,
      globalInstructions: args.globalInstructions,
      personaInstructions: args.persona.instructions,
      aboutMe,
      projectInstructions: '',
      memoryContext: args.memoryContext ?? '',
      loreContext: args.loreContext ?? '',
      knowledgeLibrariesContext: args.knowledgeLibrariesContext ?? '',
      toolsInstruction: args.toolsInstruction ?? '',
      modelInstructions: resolveModelInstructions(args.offering),
      screenEffectsEnabled: args.screenEffectsEnabled,
      roleplayEnabled: args.persona.roleplay,
      narration: args.persona.narration,
      personaName: args.persona.name,
      openerContext: resolveOpenerContext(args.priorMessages, job),
      time: timeOn ? promptTimeInput(job, args) : undefined,
    },
    job,
  );

  const wireMessages = buildEngineWireMessages(
    systemPrompt,
    args.priorMessages,
    args.userMessageText,
    args.toolExchange ?? [],
    args.replay,
    timeOn && job === 'chat' ? { activeTurn: args.userMessageAt } : undefined,
  );

  const budget = resolveContextWindow(args.persona, args.offering);
  const { messages: sentMessages } = truncateToWindow(wireMessages, budget);
  const usedTokens = sentMessages.reduce((s, m) => s + wireTokens(m), 0);

  const extras: Record<string, unknown> = {
    ...resolveReasoningBodyExtras(args.offering.profile.reasoning, args.reasoning),
    temperature: args.persona.temperature,
  };

  const contentBuffer: ContentBlock[] = [];
  const pillRows: PillRow[] = [];
  let finishReason: StreamEngineResult['finishReason'] = 'unknown';
  // For the hidden-reasoning marker (offerings whose provider reasons internally
  // but never surfaces the trace text — Inkling today). We only synthesise a
  // marker when NO trace text arrived and the billed reasoning is non-trivial.
  let sawReasoningText = false;
  let reasoningTokens = 0;

  for await (const chunk of streamCompletion({
    provider: args.provider,
    providerConfig: args.providerConfig,
    apiKey: args.apiKey,
    target: offeringToTarget(args.offering),
    messages: sentMessages,
    bodyExtras: extras,
    cacheKey: args.chat.id,
    tools: args.tools,
    signal: args.signal,
    onRetry: (e) => console.warn(formatRetryEvent(e)),
    onDiagnostics: args.onDiagnostics,
  })) {
    args.onChunk(chunk);

    if (chunk.type === 'token') {
      appendText(contentBuffer, chunk.text);
    } else if (chunk.type === 'reasoning') {
      if (chunk.text) sawReasoningText = true;
      appendReasoning(contentBuffer, chunk.text);
    } else if (chunk.type === 'tool-call') {
      const pill: PillRow = {
        id: uuidv7(),
        messageId: '', // filled by stream-manager when persisting
        kind: 'tool-call',
        positionHint: 'inline',
        status: 'pending',
        payload: {
          name: chunk.name,
          argumentsJson: chunk.argumentsJson,
          toolCallId: chunk.toolCallId,
        },
        createdAt: Date.now(),
      };
      pillRows.push(pill);
      contentBuffer.push({ type: 'pill', pillId: pill.id });
    } else if (chunk.type === 'finish') {
      finishReason = chunk.reason;
    } else if (chunk.type === 'usage') {
      // Usage display is a later feature (a subsequent catalogue-runtime slice).
      // We read only reasoningTokens here, for the hidden-reasoning marker below.
      if (typeof chunk.usage.reasoningTokens === 'number') {
        reasoningTokens = chunk.usage.reasoningTokens;
      }
    } else if (chunk.type === 'error') {
      throw new Error(`stream-engine: upstream ${chunk.message}`);
    }
  }

  // Hidden-reasoning marker: the offering reasoned internally but its provider
  // never surfaced the trace text on our route, so there is nothing to stream
  // into a reasoning group. Synthesise a terminal "(hidden reasoning, n tokens)"
  // block at the reasoning slot (front) instead of leaving the turn looking as
  // though reasoning did nothing. Reaching here means the stream finished
  // cleanly — an abort or upstream error throws mid-loop, so a failed turn never
  // plants a marker (and never renders an "undefined tokens" broken state).
  if (
    args.offering.profile.reasoningTraceHidden &&
    !sawReasoningText &&
    reasoningTokens >= HIDDEN_REASONING_FLOOR
  ) {
    contentBuffer.unshift({ type: 'reasoning', text: '', hiddenTokens: reasoningTokens });
  }

  return { finalContentBlocks: contentBuffer, pillRows, finishReason, usedTokens };
}

/** The time segment's inputs for a persona whose switch is on. */
function promptTimeInput(
  job: 'chat' | 'greeting',
  args: Pick<StartStreamArgs, 'openerAt' | 'persona'>,
): PromptTimeInput | undefined {
  if (job === 'chat') return { mode: 'chat' };
  if (!args.openerAt) return undefined;
  // The Dexie v28 backfill stamped chatless personas with their own createdAt,
  // so a value at or before creation records no conversation; reading it as one
  // would have the opener invent a past talk.
  const raw = args.persona.lastInteractionAt;
  const last = raw !== undefined && raw > args.persona.createdAt ? raw : undefined;
  return {
    mode: 'greeting',
    now: args.openerAt.createdAt,
    utcOffsetMinutes: args.openerAt.utcOffsetMinutes,
    ...(last !== undefined ? { lastInteractionAt: last } : {}),
  };
}

/** Below this many billed reasoning tokens, a hidden-reasoning turn plants no
 *  marker — a trivial "hi" (~24 tokens) would otherwise clutter the chat surface
 *  every turn, since the toggle defaults on. Tunable; see the 2026-07-16 spec. */
const HIDDEN_REASONING_FLOOR = 100;

/** Append text to the tail of the content buffer, coalescing adjacent text blocks. */
function appendText(buf: ContentBlock[], text: string): void {
  const last = buf[buf.length - 1];
  if (last && last.type === 'text') {
    last.text += text;
  } else {
    buf.push({ type: 'text', text });
  }
}

/** Append reasoning to the tail of the content buffer, coalescing adjacent reasoning blocks. */
function appendReasoning(buf: ContentBlock[], text: string): void {
  const last = buf[buf.length - 1];
  if (last && last.type === 'reasoning') {
    last.text += text;
  } else {
    buf.push({ type: 'reasoning', text });
  }
}

/** Time stamping for one wire build. Present only when the persona knows the
 *  time: prior user rows are stamped from their own stored fields, the active
 *  turn from `activeTurn` (unstamped when absent). */
export interface WireStamping {
  activeTurn?: SentAt;
}

/**
 * Assemble the wire message list for one engine pass: system prompt, replayed
 * history, the active user turn, then any accumulated tool exchange from prior
 * loop rounds. Prior persona turns replay their recorded tool rounds as
 * assistant(tool_calls) + tool messages when a replay context is given (see
 * `tool-replay.ts`), and prior user turns carry their resolved attachments.
 * With `stamp`, every real user turn leads with its `<sent>` stamp; nothing
 * else changes, so earlier turns stay byte-identical from one turn to the next.
 *
 * `userContent` accepts a plain string for text-only turns or a
 * `WireContentPart[]` for multimodal turns (text + images).
 */
export function buildEngineWireMessages(
  systemPrompt: string,
  priorMessages: MessageRow[],
  userContent: string | WireContentPart[],
  toolExchange: WireMessage[],
  replay?: ReplayContext,
  stamp?: WireStamping,
): WireMessage[] {
  const active = stamp?.activeTurn;
  return [
    { role: 'system', content: systemPrompt },
    ...replayHistory(
      priorMessages.filter(isContextMessage),
      replay,
      stamp ? userTurnStamp : undefined,
    ),
    {
      role: 'user',
      content: active
        ? prependStamp(userContent, formatSentStamp(active.createdAt, active.utcOffsetMinutes))
        : userContent,
    },
    ...toolExchange,
  ];
}
