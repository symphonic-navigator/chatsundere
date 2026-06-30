// SPDX-License-Identifier: AGPL-3.0-only
import type { MessageRow, SeedTemplateRow, SeedTurn } from '../boot/client-data-db.js';
import { flattenAnswerText } from './content-blocks.js';

/** Role implied by a 0-based body position: even = user, odd = persona. */
export function roleAt(index: number): 'user' | 'persona' {
  return index % 2 === 0 ? 'user' : 'persona';
}

/** Re-derive every turn's role from its position (used after insert/delete/reorder). */
export function normaliseBody(turns: { text: string }[]): SeedTurn[] {
  return turns.map((t, i) => ({ role: roleAt(i), text: t.text }));
}

/** True when the body alternates user-first with no empty (whitespace-only) turns. */
export function isValidBody(body: SeedTurn[]): boolean {
  return body.every((turn, i) => turn.text.trim().length > 0 && turn.role === roleAt(i));
}

/** True when the body ends on a persona turn (so the real user message follows cleanly). */
export function endsOnPersona(body: SeedTurn[]): boolean {
  return body.length > 0 && body[body.length - 1]?.role === 'persona';
}

/** Applyable = a non-empty greeting OR a non-empty, valid body. */
export function isApplyable(t: Pick<SeedTemplateRow, 'greeting' | 'body'>): boolean {
  const hasGreeting = (t.greeting ?? '').trim().length > 0;
  const hasBody = t.body.length > 0 && isValidBody(t.body);
  return hasGreeting || hasBody;
}

export interface ExportInput {
  messages: MessageRow[];
  /** The conversation prefix is captured up to and including this message id. */
  uptoMessageId: string;
  /** The source chat/persona NSFW flag; NSFW is monotonic (true wins). */
  sourceNsfw: boolean;
}

export interface ExportResult {
  greeting: string | null;
  body: SeedTurn[];
  nsfw: boolean;
}

/**
 * Map a conversation prefix to a template. A leading opener (or seed greeting)
 * becomes the greeting; the remaining real turns become an alternating,
 * user-first body re-roled by position. Tier-A plain text only — pills,
 * reasoning, tools and attachments are stripped via {@link flattenAnswerText}.
 * `system` rows are dropped. NSFW is monotonic (sourceNsfw → true).
 */
export function captureTemplate(input: ExportInput): ExportResult {
  const { messages, uptoMessageId, sourceNsfw } = input;
  const idx = messages.findIndex((m) => m.id === uptoMessageId);
  const slice = idx >= 0 ? messages.slice(0, idx + 1) : messages.slice();
  const relevant = slice.filter((m) => m.role !== 'system');

  let greeting: string | null = null;
  let rest = relevant;
  const first = relevant[0];
  if (
    first !== undefined &&
    (first.kind === 'opener' || (first.kind === 'seed' && first.seedRole === 'greeting'))
  ) {
    greeting = flattenAnswerText(first.contentBlocks);
    rest = relevant.slice(1);
  }

  const body = normaliseBody(rest.map((m) => ({ text: flattenAnswerText(m.contentBlocks) })));
  return { greeting, body, nsfw: sourceNsfw };
}
