// SPDX-License-Identifier: AGPL-3.0-only
import type { MessageRow } from '../boot/client-data-db.js';
import { flattenAnswerText } from './content-blocks.js';

export interface TocEntry {
  messageId: string;
  label: string;
  role: MessageRow['role'];
  starred: boolean;
  /** True when `label` is the derived snippet (no custom bookmarkLabel). */
  isDefaultLabel: boolean;
}

export interface Toc {
  pinned: TocEntry[];
  timeline: TocEntry[];
}

const SNIPPET_MAX = 40;

/** Short, word-boundary-trimmed label derived from a message's answer text. */
export function snippet(message: MessageRow): string {
  const firstLine = (flattenAnswerText(message.contentBlocks).split('\n')[0] ?? '').trim();
  if (firstLine.length <= SNIPPET_MAX) return firstLine;
  const cut = firstLine.slice(0, SNIPPET_MAX);
  const lastSpace = cut.lastIndexOf(' ');
  const base = (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd();
  return `${base}…`;
}

/** Resolved display label: a non-empty custom label, else the snippet. */
export function labelFor(message: MessageRow): string {
  const custom = message.bookmarkLabel ?? null;
  return custom && custom.trim() !== '' ? custom : snippet(message);
}

function toEntry(m: MessageRow): TocEntry {
  const custom = m.bookmarkLabel ?? null;
  const hasCustom = custom !== null && custom.trim() !== '';
  return {
    messageId: m.id,
    label: hasCustom ? custom : snippet(m),
    role: m.role,
    starred: m.bookmarked === true,
    isDefaultLabel: !hasCustom,
  };
}

/** Build the two-section ToC. Timeline = all user messages (ChatGPT-style
 *  auto-index); pinned = all starred messages (user + persona). Both ordered
 *  by createdAt. */
export function buildToc(messages: MessageRow[]): Toc {
  const ordered = [...messages].sort((a, b) => a.createdAt - b.createdAt);
  return {
    pinned: ordered.filter((m) => m.bookmarked === true).map(toEntry),
    timeline: ordered.filter((m) => m.role === 'user').map(toEntry),
  };
}
