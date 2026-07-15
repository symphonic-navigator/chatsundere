// SPDX-License-Identifier: AGPL-3.0-only
import type { MemoryRawResponse } from '../memory/pipeline.js';

/** True when the model returned no usable text — the "only reasoning, or
 *  nothing" case that makes a consolidation failure look opaque. */
export function hasEmptyContent(r: MemoryRawResponse): boolean {
  return r.content.trim() === '';
}

const NO_REASONING = '(no reasoning returned)';
const NO_CONTENT = '(empty — the model returned no content)';

/** Plain-text rendering of a captured model answer, for copy-and-paste to us. */
export function formatMemoryResponse(r: MemoryRawResponse): string {
  return [
    '=== Chatsundere Memory — Model Answer ===',
    `Finish reason: ${r.finishReason ?? '(none)'}`,
    '',
    '[Reasoning]',
    r.reasoning.trim() === '' ? NO_REASONING : r.reasoning,
    '',
    '[Content]',
    hasEmptyContent(r) ? NO_CONTENT : r.content,
  ].join('\n');
}
