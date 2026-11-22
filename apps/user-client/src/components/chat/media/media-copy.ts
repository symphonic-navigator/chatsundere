// SPDX-License-Identifier: AGPL-3.0-only
import type { MediaFailCause } from '../../../lib/media/media-save.js';
import type { MediaKind } from '../../../mcp/media-extract.js';

const MIB = 1_048_576;
const files = (n: number): string => `${n} ${n === 1 ? 'file' : 'files'}`;
/** Small files would sit on "0 of 1 MB" for their whole save, so they get one decimal. */
const mb = (bytes: number): string => {
  const value = bytes / MIB;
  return String(value < 10 ? Number(value.toFixed(1)) : Math.round(value));
};

/** Every user-facing string of the media card and its players, in one place. */
export const mediaCopy = {
  saving(kind: MediaKind, progress?: { done: number; total: number | null }): string {
    const noun = kind === 'audio' ? 'audio' : 'video';
    if (progress && progress.total !== null) {
      return `Saving ${noun} · ${mb(progress.done)} of ${mb(progress.total)} MB`;
    }
    return `Saving ${noun}…`;
  },
  downloading: 'Downloading from your vault…',
  deviceOnly: 'This file lives only on the device that saved it.',
  failed: {
    expired: 'The link has expired, so the file could not be saved.',
    unreachable: "Couldn't reach the file.",
    'wrong-type': "This wasn't the audio or video it claimed to be.",
    'too-large': 'This file is too large to save.',
  } satisfies Record<MediaFailCause, string>,
  tryAgain: 'Try again',
  openOriginal: 'Open original',
  download: 'Download',
  openInTreasury: 'Open in Treasury',
  linkExpired: 'The link has expired.',
  cannotFetchAgain: "This file can't be fetched again.",
  fullscreen: 'Fullscreen',
  duplicates: (n: number): string => `Same ${files(n)} as above`,
  duplicatesGone: 'The earlier files are no longer in this chat.',
  refused: (n: number): string => `${files(n)} not shown: unsupported type`,
  provider: (serverLabel: string, toolName?: string): string =>
    toolName ? `${serverLabel} · ${toolName}` : serverLabel,
  play: (title: string): string => `Play ${title}`,
  pause: (title: string): string => `Pause ${title}`,
  seek: (title: string): string => `Seek ${title}`,
  more: (title: string): string => `More for ${title}`,
  position: (current: string, total: string): string => `${current} of ${total}`,
};
