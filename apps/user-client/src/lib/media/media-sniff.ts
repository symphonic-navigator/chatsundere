// SPDX-License-Identifier: AGPL-3.0-only

function ascii(head: Uint8Array, offset: number, text: string): boolean {
  if (head.length < offset + text.length) return false;
  for (let i = 0; i < text.length; i++) {
    if (head[offset + i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

/** Recognise a media container from its first bytes; null when it is none we accept. */
export function sniffMediaMime(head: Uint8Array): string | null {
  if (ascii(head, 0, 'ID3')) return 'audio/mpeg';
  if (ascii(head, 0, 'OggS')) return 'audio/ogg';
  if (ascii(head, 0, 'fLaC')) return 'audio/flac';
  if (ascii(head, 0, 'RIFF') && ascii(head, 8, 'WAVE')) return 'audio/wav';
  if (
    head.length >= 4 &&
    head[0] === 0x1a &&
    head[1] === 0x45 &&
    head[2] === 0xdf &&
    head[3] === 0xa3
  )
    return 'video/webm';
  if (ascii(head, 4, 'ftyp')) {
    if (ascii(head, 8, 'qt')) return 'video/quicktime';
    if (ascii(head, 8, 'M4A ')) return 'audio/mp4';
    return 'video/mp4';
  }
  const b0 = head[0];
  const b1 = head[1];
  if (head.length >= 2 && b0 === 0xff && b1 !== undefined && (b1 & 0xe0) === 0xe0) {
    // Layer bits 00 are ADTS AAC rather than an MPEG audio frame.
    return (b1 & 0x06) === 0 ? 'audio/aac' : 'audio/mpeg';
  }
  return null;
}

/** WebM and ISO BMFF carry audio or video alike, so the claimed top-level type may differ. */
const EITHER_TYPE: ReadonlyArray<ReadonlySet<string>> = [
  new Set(['audio/webm', 'video/webm']),
  new Set(['audio/mp4', 'video/mp4', 'video/quicktime']),
];

/** True when the sniffed container is plausible for the claimed mime type. */
export function sniffAgrees(claimed: string, sniffed: string | null): boolean {
  if (sniffed === null) return false;
  if (claimed.split('/')[0] === sniffed.split('/')[0]) return true;
  return EITHER_TYPE.some((family) => family.has(claimed) && family.has(sniffed));
}
