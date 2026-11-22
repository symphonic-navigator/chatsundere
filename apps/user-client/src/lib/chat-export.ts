// SPDX-License-Identifier: AGPL-3.0-only
import type {
  AttachmentRow,
  ChatRow,
  ContentBlock,
  MessageRow,
  PillRow,
} from '../boot/client-data-db.js';
import { flattenAnswerText } from './content-blocks.js';
import { displayPlainText } from './teal/display-plain-text.js';
import { toolDisplayName } from './tool-display-name.js';

/** Everything `chatToMarkdown` needs, already loaded: the builder never touches the DB. */
export interface ChatExportInput {
  chat: Pick<ChatRow, 'title' | 'createdAt'>;
  personaName: string;
  /** `settings.displayName`; blank falls back to "You". */
  userName: string;
  /** Sorted by `createdAt`, as the chat stream shows them. */
  messages: readonly MessageRow[];
  pills: ReadonlyMap<string, PillRow>;
  /** Attachment rows per message id, sorted by `order`. */
  attachments: ReadonlyMap<string, readonly AttachmentRow[]>;
  exportedAt: number;
  /** The reply streaming right now, left out of the file; null when none. */
  streamingMessageId?: string | null;
}

// Fixed English names rather than Intl: the file reads the same on every
// device locale, matching the British convention of the chat's own labels.
const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;
const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

const pad = (n: number): string => String(n).padStart(2, '0');
const clock = (d: Date): string => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const isoDay = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dayHeading = (d: Date): string =>
  `${WEEKDAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;

/** The title as the file states it: the chat's own, or "Chat with {persona}". */
export function chatExportTitle(chat: ChatExportInput['chat'], personaName: string): string {
  const own = chat.title?.replace(/\s+/g, ' ').trim();
  return own ? own : `Chat with ${personaName}`;
}

/** A front-matter value, double-quoted (JSON is valid YAML) wherever a plain scalar would misparse. */
function yamlValue(value: string): string {
  const v = value.replace(/\s+/g, ' ').trim();
  // Anything opening like a number is quoted outright: YAML resolvers read
  // `1e3`, `0x1F` and `1_000` as numbers, and listing every numeric form is a
  // losing game. A letter start leaves only the boolean and null words.
  const plain = /^\p{L}[^:#"'\\]*$/u.test(v) && !/^(?:true|false|yes|no|on|off|null|y|n)$/i.test(v);
  return plain ? v : JSON.stringify(v);
}

/** One italic marker line, the form the spec gives for everything that is not text. */
const marker = (text: string): string => `*[${text}]*`;

/** The marker lines a pill leaves in the file; empty for pills the export drops. */
function pillLines(row: PillRow | undefined): string[] {
  if (!row) return [];
  if (row.kind === 'image-result') return [marker('Generated image')];
  if (row.kind !== 'tool-call') return []; // lore injection and voice expression
  const p = row.payload as { name?: unknown; artefactIds?: unknown; media?: unknown } | undefined;
  const name = typeof p?.name === 'string' && p.name ? p.name : 'tool';
  if (name === 'generate_image' && Array.isArray(p?.artefactIds) && p.artefactIds.length > 0) {
    return p.artefactIds.map(() => marker('Generated image'));
  }
  return [marker(`Used tool: ${toolDisplayName(name)}`), ...mediaLines(p?.media)];
}

/** One marker per audio or video file an MCP result brought into the chat. */
function mediaLines(media: unknown): string[] {
  if (!Array.isArray(media)) return [];
  return media.flatMap((item: unknown) => {
    const i = item as { kind?: unknown; title?: unknown } | null;
    if (typeof i?.title !== 'string') return [];
    if (i.kind === 'audio') return [marker(`Audio: ${i.title}`)];
    if (i.kind === 'video') return [marker(`Video: ${i.title}`)];
    return [];
  });
}

/** The body of one message as chunks (paragraphs or marker lines), in the order the chat shows them. */
function bodyChunks(m: MessageRow, input: ChatExportInput): string[] {
  const chunks: string[] = [];
  let run: ContentBlock[] = [];
  const flush = (): void => {
    const text = displayPlainText(flattenAnswerText(run)).trim();
    if (text) chunks.push(text);
    run = [];
  };
  for (const block of m.contentBlocks) {
    if (block.type === 'reasoning') continue;
    if (block.type === 'text') {
      run.push(block);
      continue;
    }
    flush();
    chunks.push(...pillLines(input.pills.get(block.pillId)));
  }
  flush();
  // The chat shows sent attachments beneath the user's text.
  for (const a of input.attachments.get(m.id) ?? []) {
    if (a.state !== 'active') continue;
    chunks.push(marker(`${a.kind === 'image' ? 'Image' : 'File'}: ${a.fileName}`));
  }
  if (m.streamingState === 'incomplete') chunks.push(marker('Reply interrupted'));
  return chunks;
}

/** When the chat began, as the file states it: the chat row, or an earlier message a branch carried over. */
export function chatExportStartedAt(input: Pick<ChatExportInput, 'chat' | 'messages'>): number {
  const first = input.messages[0]?.createdAt;
  return first === undefined ? input.chat.createdAt : Math.min(first, input.chat.createdAt);
}

/**
 * The chat as a readable Markdown file (spec 2026-11-18 Part B2): front
 * matter, a title, day headings, and each message as `**Name** · HH:MM`
 * followed by its text as the Copy action yields it. Reasoning is left out,
 * attachments appear by name only, and a reply still streaming is replaced by
 * a closing note. Times are the device's local time.
 */
export function chatToMarkdown(input: ChatExportInput): string {
  const title = chatExportTitle(input.chat, input.personaName);
  const userName = input.userName.trim() || 'You';
  const started = new Date(chatExportStartedAt(input));
  const exported = new Date(input.exportedAt);
  const lines: string[] = [
    '---',
    `title: ${yamlValue(title)}`,
    `persona: ${yamlValue(input.personaName)}`,
    `started: ${isoDay(started)} ${clock(started)}`,
    `exported: ${isoDay(exported)} ${clock(exported)}`,
    '---',
    '',
    `# ${title}`,
    '',
  ];

  let day: string | null = null;
  for (const m of input.messages) {
    if (m.id === input.streamingMessageId) continue;
    const chunks = bodyChunks(m, input);
    if (chunks.length === 0) continue;
    const when = new Date(m.createdAt);
    if (isoDay(when) !== day) {
      day = isoDay(when);
      lines.push(`## ${dayHeading(when)}`, '');
    }
    const name = m.role === 'user' ? userName : input.personaName;
    lines.push(`**${name}** · ${clock(when)}`, '');
    for (const chunk of chunks) lines.push(chunk, '');
  }

  if (input.streamingMessageId) lines.push(marker('Reply in progress, not included'), '');
  return lines.join('\n');
}

/**
 * A file-name part: diacritics folded ("Café über Nacht" → `cafe-uber-nacht`),
 * letters and digits of any script kept, everything else collapsed to single
 * hyphens; `chat` when nothing is left.
 */
export function exportSlug(text: string): string {
  const s = text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'chat';
}

/** The export's file name: `{persona}-{title}-{YYYY-MM-DD}.md`, or `{persona}-chat-{date}.md` untitled. */
export function chatExportFileName(
  personaName: string,
  title: string | null,
  startedAtMs: number,
): string {
  const middle = title?.trim() ? exportSlug(title) : 'chat';
  return `${exportSlug(personaName)}-${middle}-${isoDay(new Date(startedAtMs))}.md`;
}
