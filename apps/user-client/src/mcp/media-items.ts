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
  /** The tool result the item's save belongs to, shared by the items of one result. */
  owner?: string;
}

/** What the MCP tools need to save media from a result: the chat it lands in and the save service. */
export interface McpMediaContext {
  chatId: string;
  personaId: string;
  save: typeof saveMedia;
  /** The stored title of an earlier artefact, so the model can name what a duplicate repeats. */
  titleOf?: (artefactId: string) => Promise<string | null>;
}

/**
 * A pill payload with no media `source` left: a transfer pack must not carry signed links
 * out (they are bearer tokens), nor bring links in that a card would then fetch on its own.
 */
export function withoutMediaSources(payload: unknown): unknown {
  if (payload === null || typeof payload !== 'object') return payload;
  const media = (payload as { media?: unknown }).media;
  if (!Array.isArray(media)) return payload;
  return {
    ...payload,
    media: media.map((item: unknown) => {
      if (item === null || typeof item !== 'object') return item;
      const { source: _source, ...rest } = item as Record<string, unknown>;
      return rest;
    }),
  };
}

const KIND_LABEL: Record<MediaKind, string> = { audio: 'Audio', video: 'Video' };

/**
 * The title a file is shown and named by: the provider's own name when it chose one, else
 * "Audio <index>" (1-based within its kind). A lone file is numbered too, so "Audio 1" reads
 * the same to the user and the model.
 */
export function titleFor(ref: MediaRef, index: number): string {
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
 * The one line put before the tool output that tells the model what the user truly sees,
 * with the names to use for each file. Never carries a URL. `earlierTitles` maps the
 * artefact a duplicate repeats to its title, where the tool could look it up.
 */
export function modelLineFor(
  items: MediaItem[],
  earlierTitles?: ReadonlyMap<string, string>,
): string {
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
  const unnamed: MediaItem[] = [];
  for (const item of duplicates) {
    const earlier = item.artefactId ? earlierTitles?.get(item.artefactId) : undefined;
    if (earlier) sentences.push(`${item.title} here is the same file as "${earlier}" shown above.`);
    else unnamed.push(item);
  }
  if (unnamed.length > 0) {
    sentences.push(
      unnamed.length === 1
        ? `${names(unnamed)} is the same file already shown above.`
        : `${names(unnamed)} are the same files already shown above.`,
    );
  }
  const failed = items.filter((i) => i.status === 'failed');
  const byCause = new Map<MediaFailCause, MediaItem[]>();
  for (const item of failed) {
    const cause = item.cause ?? 'unreachable';
    byCause.set(cause, [...(byCause.get(cause) ?? []), item]);
  }
  for (const [cause, group] of byCause) {
    sentences.push(`${names(group)} could not be saved (${CAUSE_PHRASE[cause]}).`);
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
