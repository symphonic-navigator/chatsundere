// SPDX-License-Identifier: AGPL-3.0-only
import type { MessageRow } from '../boot/client-data-db.js';
import { flattenAnswerText } from '../lib/content-blocks.js';

type PriorMessage = Pick<MessageRow, 'role' | 'kind' | 'contentBlocks'>;

/**
 * The texts that count as written by the user for the connector tool's rule 8: the
 * text blocks of the chat's user turns and the current message. Persona and system
 * messages, tool calls and results (pills), attachments (never in `contentBlocks`) and
 * seed turns from a template are left out.
 */
export function connectorUserTexts(
  prior: readonly PriorMessage[],
  current: { text: string; seed: boolean },
): string[] {
  const texts = prior
    .filter((m) => m.role === 'user' && m.kind !== 'seed')
    .map((m) => flattenAnswerText(m.contentBlocks));
  return current.seed ? texts : [...texts, current.text];
}
