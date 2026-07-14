// SPDX-License-Identifier: AGPL-3.0-only
import { estimateTokens } from '../lib/token-estimator.js';

/**
 * Build the <usermemory> block for system-prompt injection: the whole body
 * first, then committed, then pending journal entries. Within each group, the
 * newest entries survive a tight token budget; survivors are emitted in
 * chronological order. Returns '' when there is no content.
 */
export function assembleMemoryContext(input: {
  memoryBody: string;
  committed: string[];
  uncommitted: string[];
  maxTokens?: number;
}): string {
  const { memoryBody, committed, uncommitted } = input;
  if (!memoryBody && !committed.length && !uncommitted.length) return '';

  let remaining = input.maxTokens ?? 6000;
  const sections: string[] = [];

  if (memoryBody) {
    const block = `<memory-body>\n${memoryBody}\n</memory-body>`;
    remaining -= estimateTokens(block);
    sections.push(block);
  }

  const journalLines: string[] = [];
  // Select newest-first so a large backlog degrades to "oldest out of context",
  // never "yesterday forgotten"; emit survivors in chronological reading order.
  const push = (marker: string, items: string[]): void => {
    const kept: string[] = [];
    for (const item of [...items].reverse()) {
      const line = `- [${marker}] ${item}`;
      const cost = estimateTokens(line);
      if (cost <= remaining) {
        remaining -= cost;
        kept.unshift(line);
      }
    }
    journalLines.push(...kept);
  };
  push('committed', committed);
  push('pending', uncommitted);

  if (journalLines.length) {
    sections.push(`<journal>\n${journalLines.join('\n')}\n</journal>`);
  }

  return `<usermemory priority="normal">\n${sections.join('\n')}\n</usermemory>`;
}
