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
import { type ChatRow, type PersonaRow, getClientDataDb } from '../boot/client-data-db.js';
import {
  AUTO_COMMIT_KEEP_RECENT,
  AUTO_COMMIT_THRESHOLD,
  DREAM_THRESHOLD,
  EXTRACTION_MIN_NEW_MESSAGES,
  EXTRACTION_WINDOW_CAP,
  MEMORY_BODY_MAX_TOKENS,
  UNCOMMITTED_CAP,
} from './config.js';
import { buildConsolidationPrompt, validateMemoryBody } from './consolidation-prompt.js';
import { dropDuplicates } from './dedup.js';
import { parseExtractionOutput } from './extraction-parse.js';
import { buildExtractionPrompt, stripTechnicalContent } from './extraction-prompt.js';
import { releaseMemoryLock, tryAcquireMemoryLock } from './mutex.js';
import {
  addJournalEntries,
  advanceCursor,
  archiveCommitted,
  commitOldestUncommitted,
  countJournal,
  getCurrentBody,
  getUnextractedUserText,
  listJournal,
  saveBody,
} from './repo.js';

export interface MemoryPipelineArgs {
  persona: PersonaRow;
  chat: ChatRow;
  provider: ProviderDefinition;
  providerConfig: ProviderConfig;
  apiKey: string;
  offering: Offering;
}

async function callModel(
  args: MemoryPipelineArgs,
  systemPrompt: string,
  userPrompt: string,
  maxTokens: number,
): Promise<string> {
  const messages: WireMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];
  return runOneShotCompletion({
    provider: args.provider,
    providerConfig: args.providerConfig,
    apiKey: args.apiKey,
    target: offeringToTarget(args.offering),
    messages,
    // Reasoning off: extraction/dreaming need the answer in `content`, not the
    // reasoning channel (see title-generator.ts). Fixed-on models still survive.
    bodyExtras: { temperature: 0.3, max_tokens: maxTokens, reasoning: { enabled: false } },
    onRetry: (e) => console.warn(formatRetryEvent(e)),
  });
}

/** Extract memories from the chat's unextracted user messages. Returns entries added. */
export async function runExtraction(
  args: MemoryPipelineArgs,
  opts: { force?: boolean } = {},
): Promise<number> {
  const freshChat = await getClientDataDb().chats.get(args.chat.id);
  const cursor = freshChat?.lastExtractedMessageId ?? null;
  const { texts, newCursor } = await getUnextractedUserText(
    args.chat.id,
    cursor,
    EXTRACTION_WINDOW_CAP,
  );
  if (!opts.force && texts.length < EXTRACTION_MIN_NEW_MESSAGES) return 0;

  const cleaned = texts.map(stripTechnicalContent).filter((t) => t.trim() !== '');
  if (!cleaned.length) {
    if (newCursor) await advanceCursor(args.chat.id, newCursor);
    return 0;
  }

  const body = await getCurrentBody(args.persona.id);
  const existing = (await listJournal(args.persona.id)).filter((e) => e.state !== 'archived');
  const system = buildExtractionPrompt({
    memoryBody: body?.content ?? null,
    journalEntries: existing.map((e) => e.content),
    messages: cleaned,
    userGuidance: args.persona.memoryInstructions ?? '',
  });
  const raw = await callModel(args, system, 'Extract now and return only the JSON array.', 1024);
  const fresh = dropDuplicates(
    parseExtractionOutput(raw),
    existing.map((e) => e.content),
    body?.content ?? '',
  );

  const room = Math.max(0, UNCOMMITTED_CAP - (await countJournal(args.persona.id, 'uncommitted')));
  const toAdd = fresh.slice(0, room);
  if (toAdd.length) await addJournalEntries(args.persona.id, toAdd);
  if (newCursor) await advanceCursor(args.chat.id, newCursor);
  return toAdd.length;
}

/** Promote oldest uncommitted entries when the backlog crosses the threshold. */
export async function runAutoCommit(personaId: string): Promise<number> {
  if ((await countJournal(personaId, 'uncommitted')) < AUTO_COMMIT_THRESHOLD) return 0;
  return commitOldestUncommitted(personaId, AUTO_COMMIT_KEEP_RECENT);
}

/** Consolidate committed entries into a new body version. Returns true when a body was written. */
export async function runDreaming(
  args: MemoryPipelineArgs,
  opts: { force?: boolean } = {},
): Promise<boolean> {
  const committedCount = await countJournal(args.persona.id, 'committed');
  if (committedCount === 0) return false;
  if (!opts.force && committedCount < DREAM_THRESHOLD) return false;

  const committed = await listJournal(args.persona.id, 'committed');
  const body = await getCurrentBody(args.persona.id);
  const system = buildConsolidationPrompt({
    existingBody: body?.content ?? null,
    entries: committed.map((c) => ({ content: c.content, isCorrection: c.isCorrection })),
    userGuidance: args.persona.memoryInstructions ?? '',
  });
  const raw = await callModel(args, system, 'Output only the new memory body text now.', 4096);
  const newBody = raw.trim();
  if (!validateMemoryBody(newBody, MEMORY_BODY_MAX_TOKENS)) return false;

  await saveBody(args.persona.id, newBody, committed.length, 'dream');
  await archiveCommitted(args.persona.id, uuidv7());
  return true;
}

/**
 * The post-send orchestrator: extraction → auto-commit → dreaming, gated on
 * thresholds, guarded by a per-persona mutex. Fire-and-forget; logs its own errors.
 */
export async function runMemoryPipeline(args: MemoryPipelineArgs): Promise<void> {
  if (!(args.persona.useMemory ?? true)) return;
  if (!tryAcquireMemoryLock(args.persona.id)) return;
  try {
    await runExtraction(args);
    await runAutoCommit(args.persona.id);
    await runDreaming(args);
  } catch (e) {
    console.warn('[memory] pipeline error', e);
  } finally {
    releaseMemoryLock(args.persona.id);
  }
}
