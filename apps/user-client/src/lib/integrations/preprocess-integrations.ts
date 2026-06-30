// SPDX-License-Identifier: AGPL-3.0-only
import {
  INTEGRATION_TAG_RX,
  MAX_INTEGRATION_TAG_LENGTH,
  getIntegration,
} from '@chatsundere/llm-unified';
import { maskCodeRegions } from '../markdown/code-mask.js';
import { TEAL_MARK_END, TEAL_MARK_START } from '../teal/preprocess-teal.js';

/**
 * Replace each known integration tag with a soft-glow display span, reusing
 * TEAL's PUA sentinel markers so the wrap survives micromark and is turned into
 * a styled span by the rehype-teal plugin. An unknown prefix/command or a
 * null-resolving handler leaves the tag literal. Code regions are masked, so a
 * tag inside a code span is never rewritten.
 *
 * Pure: no I/O, no DOM, no React.
 */
export function preprocessIntegrations(src: string): string {
  const { masked, restore } = maskCodeRegions(src);
  const out = masked.replace(
    INTEGRATION_TAG_RX,
    (raw: string, prefix: string, command: string, rawArgs: string) => {
      // Match findIntegrationTags' guard so the display and effect paths agree:
      // an over-long span is not a tag.
      if (raw.length > MAX_INTEGRATION_TAG_LENGTH) return raw;
      const integration = getIntegration(prefix);
      const result = integration?.handle(command, rawArgs) ?? null;
      if (result === null) return raw;
      return `${TEAL_MARK_START}sfx-glow${TEAL_MARK_END}${result.display}${TEAL_MARK_START}/sfx-glow${TEAL_MARK_END}`;
    },
  );
  return restore(out);
}
