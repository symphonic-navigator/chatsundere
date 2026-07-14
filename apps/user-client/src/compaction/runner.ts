// SPDX-License-Identifier: AGPL-3.0-only
import {
  type Offering,
  type ProviderConfig,
  type ProviderDefinition,
  type WireMessage,
  formatRetryEvent,
  offeringToTarget,
  runOneShotCompletion,
} from '@chatsundere/llm-unified';
import { uuidv7 } from 'uuidv7';
import type {
  ChatRow,
  CompactionCheckpointRow,
  MessageRow,
  PersonaRow,
} from '../boot/client-data-db.js';
import { getClientDataDb } from '../boot/client-data-db.js';
import { flattenAnswerText, isContextMessage } from '../lib/content-blocks.js';
import { resolveContextWindow } from '../lib/context-window.js';
import { estimateTokens } from '../lib/token-estimator.js';
import {
  COMPACTION_RETRY_REMINDER,
  COMPACTION_SYSTEM_PROMPT,
  type SourceMessage,
  buildCompactionTranscript,
  validateSummary,
} from './compaction-prompt.js';
import {
  COMPACTION_MAX_OUTPUT_TOKENS,
  COMPACTION_SOURCE_FRACTION,
  COMPACTION_TIMEOUT_MS,
} from './config.js';
import { getActiveCheckpoint, writeCheckpoint } from './repo.js';
import { selectTailStartIndex } from './tail.js';

export interface CompactionArgs {
  chat: ChatRow;
  persona: PersonaRow;
  provider: ProviderDefinition;
  providerConfig: ProviderConfig;
  apiKey: string;
  offering: Offering;
  trigger: 'manual' | 'auto' | 'overflow';
}

/** Map a stored message to a transcript source line: text via the shared
 *  flattener (drops pills/tool blocks); non-text blocks become ref hints. */
export function messageToSource(row: MessageRow): SourceMessage {
  const refs: string[] = [];
  for (const block of row.contentBlocks) {
    const t = (block as { type?: string }).type;
    if (t && t !== 'text') refs.push(t);
  }
  return {
    role: row.role === 'user' ? 'user' : 'persona',
    text: flattenAnswerText(row.contentBlocks),
    refs,
  };
}

async function summarise(args: CompactionArgs, transcript: string): Promise<string> {
  const call = (system: string): Promise<string> =>
    runOneShotCompletion({
      provider: args.provider,
      providerConfig: args.providerConfig,
      apiKey: args.apiKey,
      target: offeringToTarget(args.offering),
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: transcript },
      ] satisfies WireMessage[],
      timeoutMs: COMPACTION_TIMEOUT_MS,
      bodyExtras: {
        temperature: 0.3,
        max_tokens: COMPACTION_MAX_OUTPUT_TOKENS,
        reasoning: { enabled: false },
      },
      onRetry: (e) => console.warn(formatRetryEvent(e)),
    });
  const first = await call(COMPACTION_SYSTEM_PROMPT);
  if (validateSummary(first).ok) return first;
  // One retry with a reminder and a slightly higher temperature (spec §4.4).
  const second = await runOneShotCompletion({
    provider: args.provider,
    providerConfig: args.providerConfig,
    apiKey: args.apiKey,
    target: offeringToTarget(args.offering),
    messages: [
      { role: 'system', content: COMPACTION_SYSTEM_PROMPT + COMPACTION_RETRY_REMINDER },
      { role: 'user', content: transcript },
    ] satisfies WireMessage[],
    timeoutMs: COMPACTION_TIMEOUT_MS,
    bodyExtras: {
      temperature: 0.5,
      max_tokens: COMPACTION_MAX_OUTPUT_TOKENS,
      reasoning: { enabled: false },
    },
    onRetry: (e) => console.warn(formatRetryEvent(e)),
  });
  if (!validateSummary(second).ok) {
    throw new Error('compaction summary failed validation after retry');
  }
  return second;
}

/**
 * Compact a chat: carve the verbatim tail, summarise everything before it (since
 * the previous checkpoint, folding its summary in), and persist a checkpoint.
 * Returns null when there is nothing new to compact. Throws on model failure.
 */
export async function runCompaction(args: CompactionArgs): Promise<CompactionCheckpointRow | null> {
  const db = getClientDataDb();
  const all = (await db.messages.where('chatId').equals(args.chat.id).sortBy('createdAt')).filter(
    isContextMessage,
  );
  if (all.length === 0) return null;

  const window = resolveContextWindow(args.persona, args.offering);
  const tokens = all.map((m) => estimateTokens(flattenAnswerText(m.contentBlocks)));
  const tailStartIdx = selectTailStartIndex(tokens, window);
  if (tailStartIdx <= 0) return null; // nothing to compress yet

  const previous = await getActiveCheckpoint(args.chat);
  let sourceStartIdx = 0;
  if (previous) {
    const prevIdx = all.findIndex((m) => m.id === previous.tailStartMessageId);
    sourceStartIdx = prevIdx >= 0 ? prevIdx : 0;
  }
  let sourceSlice = all.slice(sourceStartIdx, tailStartIdx);
  if (sourceSlice.length === 0) return null; // already compacted up to the tail

  // Source-truncation guard (spec §4.5): drop oldest source until it fits.
  const sourceBudget = window * COMPACTION_SOURCE_FRACTION;
  while (
    sourceSlice.length > 1 &&
    sourceSlice.reduce((s, m) => s + estimateTokens(flattenAnswerText(m.contentBlocks)), 0) >
      sourceBudget
  ) {
    sourceSlice = sourceSlice.slice(1);
  }

  const tailStartMsg = all[tailStartIdx];
  const lastBeforeMsg = all[tailStartIdx - 1];
  if (!tailStartMsg || !lastBeforeMsg) return null;

  const source: SourceMessage[] = sourceSlice.map(messageToSource);
  const transcript = buildCompactionTranscript(source, previous?.summaryMarkdown ?? null);
  const markdown = await summarise(args, transcript);

  const tokensBefore = sourceSlice.reduce(
    (s, m) => s + estimateTokens(flattenAnswerText(m.contentBlocks)),
    0,
  );
  const tailTokenCount = tokens.slice(tailStartIdx).reduce((s, t) => s + t, 0);

  // Offering has no `id` field — use canonicalRef if available, else upstreamSlug.
  const modelId = args.offering.canonicalRef ?? args.offering.upstreamSlug;

  const checkpoint: CompactionCheckpointRow = {
    id: uuidv7(),
    chatId: args.chat.id,
    createdAt: Date.now(),
    modelId,
    summaryMarkdown: markdown,
    lastMessageIdBefore: lastBeforeMsg.id,
    tailStartMessageId: tailStartMsg.id,
    tokensBefore,
    tokensAfter: estimateTokens(markdown),
    tailTokenCount,
    prevCheckpointId: previous?.id ?? null,
    trigger: args.trigger,
  };
  await writeCheckpoint(checkpoint);
  return checkpoint;
}
