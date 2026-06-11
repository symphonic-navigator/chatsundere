// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Mask fenced code blocks and inline code spans with NUL-delimited sentinels
 * so string-level preprocessors never rewrite user code, then restore them.
 * Callers MUST call restore(…) before passing the text to any Markdown parser:
 * CommonMark replaces U+0000 with U+FFFD, which would make un-restored
 * sentinels permanent.
 */
export function maskCodeRegions(src: string): { masked: string; restore: (s: string) => string } {
  const masks: string[] = [];
  const mask = (m: string): string => {
    const i = masks.length;
    masks.push(m);
    return `\0CODE${i}\0`;
  };
  const masked = src
    .replace(
      /(^|\n)(```[\s\S]*?\n```|~~~[\s\S]*?\n~~~)/g,
      (_m, lead: string, fence: string) => `${lead}${mask(fence)}`,
    )
    .replace(/(`+)([\s\S]*?)\1/g, (m) => mask(m));
  const restore = (s: string): string =>
    s.replace(/\0CODE(\d+)\0/g, (_m, idx: string) => masks[Number(idx)] ?? '');
  return { masked, restore };
}
