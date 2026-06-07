// SPDX-License-Identifier: LGPL-3.0-only

/** A unit of a document ready for embedding. */
export interface Chunk {
  /** The chunk's text content. */
  text: string;
  /** The Markdown heading trail above this chunk, outermost first. */
  headingPath: string[];
  /** Zero-based position of this chunk within its document. */
  chunkIndex: number;
}

export interface ChunkOptions {
  /** Soft upper bound per chunk, in heuristic tokens (~4 chars each). Default 1000. */
  maxTokens?: number;
}

/** Rough token estimate — 4 characters per token, counting the trimmed string. Sufficient for splitting decisions. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.trim().length / 4);
}

interface Section {
  headingPath: string[];
  body: string;
}

const HEADING_RE = /^(#{1,6})\s+(.*)$/;

/** Split into heading-bounded sections, tracking the live heading stack. */
function splitIntoSections(md: string): Section[] {
  const lines = md.split(/\r\n|\r|\n/);
  const sections: Section[] = [];
  const stack: { level: number; title: string }[] = [];
  let buffer: string[] = [];

  const flush = (): void => {
    const body = buffer.join('\n').trim();
    if (body.length > 0) sections.push({ headingPath: stack.map((s) => s.title), body });
    buffer = [];
  };

  for (const line of lines) {
    const m = HEADING_RE.exec(line);
    if (m) {
      flush();
      const level = m[1]?.length ?? 1;
      const title = (m[2] ?? '').trim();
      while (stack.length > 0 && (stack[stack.length - 1]?.level ?? 0) >= level) stack.pop();
      stack.push({ level, title });
    } else {
      buffer.push(line);
    }
  }
  flush();
  return sections;
}

/** Split a body into pieces no larger than maxTokens: paragraphs → sentences → words. */
function splitBody(body: string, maxTokens: number): string[] {
  if (estimateTokens(body) <= maxTokens) return [body];

  const out: string[] = [];
  let current = '';
  const push = (piece: string): void => {
    const candidate = current.length === 0 ? piece : `${current}\n\n${piece}`;
    if (estimateTokens(candidate) <= maxTokens) {
      current = candidate;
    } else {
      if (current.length > 0) out.push(current);
      current = piece;
    }
  };

  const paragraphs = body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  for (const para of paragraphs) {
    if (estimateTokens(para) <= maxTokens) {
      push(para);
      continue;
    }
    const sentences = para
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const sentence of sentences) {
      if (estimateTokens(sentence) <= maxTokens) {
        push(sentence);
        continue;
      }
      const words = sentence.split(/\s+/);
      let acc = '';
      for (const w of words) {
        const cand = acc.length === 0 ? w : `${acc} ${w}`;
        if (estimateTokens(cand) <= maxTokens) {
          acc = cand;
        } else {
          if (acc.length > 0) push(acc);
          acc = w;
        }
      }
      if (acc.length > 0) push(acc);
    }
  }
  if (current.length > 0) out.push(current);
  return out;
}

/**
 * Chunk a Markdown document hierarchically: by heading sections, then by
 * paragraph/sentence/word within an oversized section. Each chunk carries the
 * heading trail above it. Empty/whitespace input yields no chunks.
 */
export function chunkMarkdown(md: string, opts: ChunkOptions = {}): Chunk[] {
  const maxTokens = opts.maxTokens ?? 1000;
  const sections = splitIntoSections(md);
  const chunks: Chunk[] = [];
  let index = 0;
  for (const section of sections) {
    for (const piece of splitBody(section.body, maxTokens)) {
      chunks.push({ text: piece, headingPath: section.headingPath, chunkIndex: index++ });
    }
  }
  return chunks;
}
