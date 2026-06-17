// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Reduce a raw chain-of-thought trace to plain prose for synthesis. Strips the
 * Markdown emphasis/code/heading/list markers a reasoning model commonly emits
 * (traces carry no TEAL expression markup, so no passthrough concern) and
 * collapses whitespace. Deliberately light-touch — not a full Markdown parser.
 */
export function toPlainMonologueText(trace: string): string {
  return trace
    .replace(/```[\s\S]*?```/g, ' ') // fenced code blocks
    .replace(/`([^`]+)`/g, '$1') // inline code
    .replace(/\*\*([^*]+)\*\*/g, '$1') // bold
    .replace(/\*([^*]+)\*/g, '$1') // italic
    .replace(/^\s{0,3}#{1,6}\s+/gm, '') // headings
    .replace(/^\s*[-*+]\s+/gm, '') // list bullets
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Split text into synthesis-sized chunks (≤ maxLen), breaking on sentence
 * boundaries where possible and never mid-word. Empty/whitespace input yields [].
 */
export function chunkForSynthesis(text: string, maxLen = 600): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= maxLen) return [trimmed];

  // Split into sentences, keeping the terminator, then greedily pack.
  const sentences = trimmed.match(/[^.!?]+[.!?]+|\S[^.!?]*$/g) ?? [trimmed];
  const chunks: string[] = [];
  let current = '';
  for (const raw of sentences) {
    const s = raw.trim();
    if (!s) continue;
    if (current && current.length + 1 + s.length > maxLen) {
      chunks.push(current);
      current = s;
    } else {
      current = current ? `${current} ${s}` : s;
    }
    // A single sentence longer than maxLen is hard-split on spaces.
    while (current.length > maxLen) {
      const cut = current.lastIndexOf(' ', maxLen);
      const at = cut > 0 ? cut : maxLen;
      chunks.push(current.slice(0, at).trim());
      current = current.slice(at).trim();
    }
  }
  if (current) chunks.push(current);
  return chunks.filter((c) => c.length > 0);
}
