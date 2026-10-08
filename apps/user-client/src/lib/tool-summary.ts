// SPDX-License-Identifier: AGPL-3.0-only
import {
  type WireMessage,
  buildPrompt,
  formatRetryEvent,
  offeringToTarget,
  runOneShotCompletion,
} from '@chatsundere/llm-unified';
import { type PillRow, getClientDataDb } from '../boot/client-data-db.js';
import { QK } from '../data/queryKeys.js';
import type { ChoreCallBundle } from '../data/resolve-background-offering.js';
import { useToolSummaryStore } from '../state/tool-summary.store.js';
import { enqueueSync, isLinkedForSync } from '../sync/enqueue.js';
import { scheduleClass1Sync } from '../sync/triggers.js';
import { queryClient } from './queryClient.js';
import {
  REPLAY_RESULT_MAX_CHARS,
  SUMMARY_INPUT_MAX_CHARS,
  isCondensable,
  replaySummaryOf,
} from './tool-replay.js';

interface ToolPayload {
  name: string;
  argumentsJson: string;
  result?: unknown;
}

/** Whether a condensable pill still lacks its summary. */
export function needsSummary(pill: PillRow): boolean {
  return isCondensable(pill) && replaySummaryOf(pill) === null;
}

/** The summariser's request: fixed system prompt plus the framed tool output (spec §3.3). */
export function buildSummaryMessages(pill: PillRow, adultPersona: boolean): WireMessage[] {
  const p = pill.payload as ToolPayload;
  const result = typeof p.result === 'string' ? p.result : '';
  const cut = result.length > SUMMARY_INPUT_MAX_CHARS;
  const system = buildPrompt(
    {
      tonalityEnabled: false,
      nsfwEnabled: adultPersona,
      globalInstructions: '',
      personaInstructions: '',
      aboutMe: '',
      projectInstructions: '',
      memoryContext: '',
      toolsInstruction: '',
      modelInstructions: '',
      screenEffectsEnabled: false,
    },
    'tool-summary',
  );
  const cutNote = cut
    ? `\nThe tool output above was cut after ${SUMMARY_INPUT_MAX_CHARS.toLocaleString('en-GB')} characters.`
    : '';
  const user = [
    `Tool: ${p.name}\nArguments: ${p.argumentsJson}\n<tool_output>\n`,
    // A literal closer in the data must not end the frame early.
    result
      .slice(0, SUMMARY_INPUT_MAX_CHARS)
      .replace(/<\/tool_output/gi, '<\\/tool_output'),
    `\n</tool_output>${cutNote}`,
  ].join('');
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/** One summary call on the chore bundle; null on any failure or blank output. */
export async function summariseToolResult(
  pill: PillRow,
  adultPersona: boolean,
  bundle: ChoreCallBundle,
): Promise<string | null> {
  try {
    const raw = await runOneShotCompletion({
      provider: bundle.provider,
      providerConfig: bundle.providerConfig,
      apiKey: bundle.apiKey,
      target: offeringToTarget(bundle.offering),
      messages: buildSummaryMessages(pill, adultPersona),
      // Reasoning off like title generation; the budget still leaves room for
      // fixed-on reasoners to emit a trace and the summary.
      bodyExtras: { temperature: 0.2, max_tokens: 1536, reasoning: { enabled: false } },
      timeoutMs: 60_000,
      onRetry: (e) => console.warn(formatRetryEvent(e)),
    });
    const text = raw.trim();
    return text === '' ? null : text.slice(0, REPLAY_RESULT_MAX_CHARS);
  } catch (err) {
    console.warn('[tool-summary] summary failed; replay keeps the head-cut', err);
    return null;
  }
}

/** Store a summary on its pill unless the pill is gone or already summarised. */
export async function writeReplaySummary(pillId: string, summary: string): Promise<boolean> {
  const db = getClientDataDb();
  const linked = isLinkedForSync();
  const written = await db.transaction('rw', [db.pills, db.syncOutbox], async (tx) => {
    const pill = await db.pills.get(pillId);
    if (!pill || replaySummaryOf(pill) !== null) return false;
    await db.pills.put({
      ...pill,
      payload: { ...(pill.payload as Record<string, unknown>), replaySummary: summary },
    });
    if (linked) enqueueSync(tx, 'pills', pillId, 'upsert');
    return true;
  });
  if (written && linked) scheduleClass1Sync();
  return written;
}

const queues = new Map<string, Promise<void>>();

/**
 * Queue a turn's long tool results for background summaries, strictly one at a
 * time per chat (spec §3.1). Best-effort: callers fire and forget.
 */
export function enqueueToolSummaries(args: {
  chatId: string;
  pills: PillRow[];
  adultPersona: boolean;
  bundle: ChoreCallBundle;
}): Promise<void> {
  const todo = args.pills.filter(needsSummary);
  if (todo.length === 0) return queues.get(args.chatId) ?? Promise.resolve();
  const store = useToolSummaryStore.getState();
  for (const p of todo) store.add(p.id);
  const prev = queues.get(args.chatId) ?? Promise.resolve();
  const next = prev.then(async () => {
    for (const p of todo) {
      try {
        // Deleted while queued: spare the provider call.
        if (!(await getClientDataDb().pills.get(p.id))) continue;
        const summary = await summariseToolResult(p, args.adultPersona, args.bundle);
        if (summary !== null && (await writeReplaySummary(p.id, summary))) {
          void queryClient.invalidateQueries({ queryKey: QK.chat(args.chatId) });
        }
      } catch (err) {
        console.warn('[tool-summary] could not store summary', err);
      } finally {
        useToolSummaryStore.getState().remove(p.id);
      }
    }
  });
  queues.set(args.chatId, next);
  void next.finally(() => {
    if (queues.get(args.chatId) === next) queues.delete(args.chatId);
  });
  return next;
}
