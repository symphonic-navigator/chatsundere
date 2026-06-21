// SPDX-License-Identifier: AGPL-3.0-only
import { estimateTokens } from '../lib/token-estimator.js';

/**
 * Build the <usermemory> block for system-prompt injection: the whole body
 * first, then committed, then pending journal entries — dropping lines once
 * the token budget is exhausted. Returns '' when there is no content.
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
  const push = (marker: string, items: string[]): void => {
    for (const item of items) {
      const line = `- [${marker}] ${item}`;
      const cost = estimateTokens(line);
      if (cost <= remaining) {
        remaining -= cost;
        journalLines.push(line);
      }
    }
  };
  push('committed', committed);
  push('pending', uncommitted);

  if (journalLines.length) {
    sections.push(`<journal>\n${journalLines.join('\n')}\n</journal>`);
  }

  return `<usermemory priority="normal">\n${sections.join('\n')}\n</usermemory>`;
}
