import {
  type Offering,
  type ProviderConfig,
  type ProviderDefinition,
  type StreamChunk,
  type StreamDiagnosticsSink,
  type ToolDef,
  type WireContentPart,
  type WireMessage,
  buildPrompt,
  formatRetryEvent,
  offeringToTarget,
  resolveModelInstructions,
  streamCompletion,
} from '@chatsundere/llm-unified';
// SPDX-License-Identifier: AGPL-3.0-only
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

export interface StartStreamArgs {
  chat: ChatRow;
  persona: PersonaRow;
  provider: ProviderDefinition;
  providerConfig: ProviderConfig;
  apiKey: string;
  corsProxyUrl: string | null;
  corsProxyKey: string | null;
  offering: Offering;
  priorMessages: MessageRow[];
  /** The active user turn content. Pass a plain string for text-only turns or a
   *  `WireContentPart[]` for multimodal turns (images + text). */
  userMessageText: string | WireContentPart[];
  reasoning: ReasoningState;
  globalInstructions: string;
  globalAboutMe: string;
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
  /** Prompt job — 'greeting' builds the opener prompt (Band 1 + About Me, no
   *  lore/knowledge/tools). Default 'chat'. */
  job?: 'chat' | 'greeting';
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
 *  chat job and a kind:'opener' message exists in history (it is never in the
 *  wire history, so the echo is the model's only continuity with it). */
export function resolveOpenerContext(
  priorMessages: MessageRow[],
  job: 'chat' | 'greeting',
): string {
  if (job !== 'chat') return '';
  const found = priorMessages.find((m) => m.kind === 'opener');
  return found ? flattenAnswerText(found.contentBlocks) : '';
}

/**
 * Orchestrate a single chat-turn against the upstream. Pure (apart from the
 * onChunk callback) — does NOT touch Dexie. Caller (stream-manager) is
 * responsible for persistence.
 */
export async function runStreamEngine(args: StartStreamArgs): Promise<StreamEngineResult> {
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
      roleplayEnabled: args.persona.roleplay,
      narration: args.persona.narration,
      personaName: args.persona.name,
      openerContext: resolveOpenerContext(args.priorMessages, args.job ?? 'chat'),
    },
    args.job ?? 'chat',
  );

  const wireMessages = buildEngineWireMessages(
    systemPrompt,
    args.priorMessages,
    args.userMessageText,
    args.toolExchange ?? [],
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

  for await (const chunk of streamCompletion({
    provider: args.provider,
    providerConfig: args.providerConfig,
    apiKey: args.apiKey,
    corsProxyUrl: args.corsProxyUrl,
    corsProxyKey: args.corsProxyKey,
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
      // Adapters emit usage chunks; we deliberately ignore them here for now.
    } else if (chunk.type === 'error') {
      throw new Error(`stream-engine: upstream ${chunk.message}`);
    }
  }

  return { finalContentBlocks: contentBuffer, pillRows, finishReason, usedTokens };
}

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

/**
 * Assemble the wire message list for one engine pass: system prompt, replayed
 * history, the active user turn, then any accumulated tool exchange from prior
 * loop rounds. Extracted so the tool-exchange placement is unit-testable.
 *
 * `userContent` accepts a plain string for text-only turns or a
 * `WireContentPart[]` for multimodal turns (text + images). Prior-turn replay
 * of attachments is the caller's responsibility (Task 14) — `toWireMessage`
 * stays text-only for v1.
 */
export function buildEngineWireMessages(
  systemPrompt: string,
  priorMessages: MessageRow[],
  userContent: string | WireContentPart[],
  toolExchange: WireMessage[],
): WireMessage[] {
  return [
    { role: 'system', content: systemPrompt },
    ...priorMessages.filter(isContextMessage).map(toWireMessage),
    { role: 'user', content: userContent },
    ...toolExchange,
  ];
}

/**
 * Collapse a persisted MessageRow to a single WireMessage for context replay.
 * Pill-blocks are dropped — Phase 3 doesn't execute tools from history.
 */
function toWireMessage(m: MessageRow): WireMessage {
  const text = flattenAnswerText(m.contentBlocks);
  if (m.role === 'persona') return { role: 'assistant', content: text };
  if (m.role === 'system') return { role: 'system', content: text };
  return { role: 'user', content: text };
}
