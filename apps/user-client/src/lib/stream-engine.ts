import {
  type Offering,
  type ProviderConfig,
  type ProviderDefinition,
  type StreamChunk,
  type WireMessage,
  buildPrompt,
  formatRetryEvent,
  offeringToTarget,
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
import { flattenAnswerText } from './content-blocks.js';
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
  userMessageText: string;
  reasoning: ReasoningState;
  globalInstructions: string;
  globalAboutMe: string;
  signal: AbortSignal;
  onChunk: (chunk: StreamChunk) => void;
}

export interface StreamEngineResult {
  finalContentBlocks: ContentBlock[];
  pillRows: PillRow[];
  finishReason: 'stop' | 'length' | 'tool_calls' | 'content_filter' | 'unknown';
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
      memoryContext: '',
    },
    'chat',
  );

  const wireMessages: WireMessage[] = [
    { role: 'system', content: systemPrompt },
    ...args.priorMessages.map(toWireMessage),
    { role: 'user', content: args.userMessageText },
  ];

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
    messages: wireMessages,
    bodyExtras: extras,
    cacheKey: args.chat.id,
    signal: args.signal,
    onRetry: (e) => console.warn(formatRetryEvent(e)),
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
        status: 'completed',
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

  return { finalContentBlocks: contentBuffer, pillRows, finishReason };
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
 * Collapse a persisted MessageRow to a single WireMessage for context replay.
 * Pill-blocks are dropped — Phase 3 doesn't execute tools from history.
 */
function toWireMessage(m: MessageRow): WireMessage {
  const text = flattenAnswerText(m.contentBlocks);
  if (m.role === 'persona') return { role: 'assistant', content: text };
  if (m.role === 'system') return { role: 'system', content: text };
  return { role: 'user', content: text };
}
