// SPDX-License-Identifier: AGPL-3.0-only
import type { MediaFailCause, saveMedia } from '../lib/media/media-save.js';
import { type MediaKind, type MediaRef, isGenericFileName } from './media-extract.js';

/** One audio or video file of an MCP result, as its pill payload carries it (`payload.media`). */
export interface MediaItem {
  key: string;
  kind: MediaKind;
  mime: string;
  /** "Audio 1", "Video 2", or a non-generic provider name. */
  title: string;
  status: 'saving' | 'saved' | 'duplicate' | 'failed';
  cause?: MediaFailCause;
  artefactId?: string;
  /** Kept only while not saved, so a fetch can be retried; dropped on 'saved'/'duplicate'. */
  source?: { url: string; expiresAt: number | null };
  /** On the first item only: unsupported files that were not shown. */
  refused?: number;
}

/** What the MCP tools need to save media from a result: the chat it lands in and the save service. */
export interface McpMediaContext {
  chatId: string;
  personaId: string;
  save: typeof saveMedia;
}

const KIND_LABEL: Record<MediaKind, string> = { audio: 'Audio', video: 'Video' };

/**
 * The title a file is shown and named by: the provider's own name when it chose one, else
 * "Audio <index>" (1-based within its kind). A lone file is numbered too, so "Audio 1" reads
 * the same to the user and the model; `kindCount` is the number of files of that kind.
 */
export function titleFor(ref: MediaRef, index: number, _kindCount: number): string {
  const name = ref.providerName?.trim() ?? '';
  if (name !== '' && !isGenericFileName(name)) return name;
  return `${KIND_LABEL[ref.kind]} ${index}`;
}

const CAUSE_PHRASE: Record<MediaFailCause, string> = {
  unreachable: 'could not reach the file',
  expired: 'the link had expired',
  'wrong-type': 'it was not the audio or video it claimed to be',
  'too-large': 'it was too large',
};

const files = (n: number): string => `${n} ${n === 1 ? 'file' : 'files'}`;

function names(items: MediaItem[]): string {
  const titles = items.map((i) => i.title);
  if (titles.length <= 1) return titles.join('');
  return `${titles.slice(0, -1).join(', ')} and ${titles[titles.length - 1]}`;
}

/** The line about refused offers, also used when a result offered nothing playable at all. */
export function refusedLine(refused: number): string {
  return `${files(refused)} ${refused === 1 ? 'was' : 'were'} not shown: unsupported type.`;
}

/**
 * The one line appended to the tool output that tells the model what the user truly sees,
 * with the names to use for each file. Never carries a URL.
 */
export function modelLineFor(items: MediaItem[]): string {
  const sentences: string[] = [];
  const shown = items.filter((i) => i.status !== 'failed');
  const describe = (item: MediaItem): string => {
    if (item.key.startsWith('gen:')) return `generation ${item.key.slice(4)}`;
    return `file ${items.indexOf(item) + 1}`;
  };
  if (shown.length > 0) {
    sentences.push(
      `Shown to the user as players: ${shown.map((i) => `${i.title} = ${describe(i)}`).join(', ')}.`,
    );
  } else {
    sentences.push('No file could be shown to the user.');
  }
  const saving = items.filter((i) => i.status === 'saving');
  if (saving.length > 0) {
    sentences.push(
      saving.length === 1
        ? `${names(saving)} is still being saved and appears when ready.`
        : `${names(saving)} are still being saved and appear when ready.`,
    );
  }
  const duplicates = items.filter((i) => i.status === 'duplicate');
  if (duplicates.length > 0) {
    sentences.push(
      duplicates.length === 1
        ? `${names(duplicates)} is the same file already shown above.`
        : `${names(duplicates)} are the same files already shown above.`,
    );
  }
  const failed = items.filter((i) => i.status === 'failed');
  if (failed.length > 0) {
    const causes = [...new Set(failed.map((i) => CAUSE_PHRASE[i.cause ?? 'unreachable']))];
    sentences.push(`${files(failed.length)} could not be saved (${causes.join('; ')}).`);
  }
  const refused = items[0]?.refused ?? 0;
  if (refused > 0) sentences.push(refusedLine(refused));
  sentences.push(
    shown.length > 0
      ? 'Refer to them by these names in prose; do not repeat their URLs.'
      : 'Do not repeat their URLs.',
  );
  return sentences.join(' ');
}
