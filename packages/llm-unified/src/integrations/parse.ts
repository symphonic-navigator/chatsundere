// SPDX-License-Identifier: LGPL-3.0-only
import type { ParsedIntegrationTag } from './types.js';

/** Longest tag we accept; guards against a stray '[' … ']' spanning a huge range. */
export const MAX_INTEGRATION_TAG_LENGTH = 160;

const HEAD = '[a-z][a-z0-9-]*';
/** Global matcher for full `[prefix:command args]` occurrences. */
export const INTEGRATION_TAG_RX = new RegExp(`\\[(${HEAD}):(${HEAD}) ([^\\]]*)\\]`, 'g');
/** Anchored matcher for bracket *content* (no surrounding brackets). */
const CONTENT_RX = new RegExp(`^(${HEAD}):(${HEAD}) ([^\\]]*)$`);

/** Parse bracket content `prefix:command args` (no brackets). Null if it is not an integration tag. */
export function parseIntegrationTag(
  content: string,
): Pick<ParsedIntegrationTag, 'prefix' | 'command' | 'rawArgs'> | null {
  const m = CONTENT_RX.exec(content);
  if (m === null) return null;
  const [, prefix, command, rawArgs] = m;
  if (prefix === undefined || command === undefined || rawArgs === undefined) return null;
  if (rawArgs.length === 0) return null;
  return { prefix, command, rawArgs };
}

/** Locate every integration tag in `text`, in order, with positions. */
export function findIntegrationTags(text: string): ParsedIntegrationTag[] {
  const out: ParsedIntegrationTag[] = [];
  INTEGRATION_TAG_RX.lastIndex = 0;
  for (let m = INTEGRATION_TAG_RX.exec(text); m !== null; m = INTEGRATION_TAG_RX.exec(text)) {
    const raw = m[0];
    const prefix = m[1];
    const command = m[2];
    const rawArgs = m[3];
    if (prefix === undefined || command === undefined || rawArgs === undefined) continue;
    if (raw.length > MAX_INTEGRATION_TAG_LENGTH || rawArgs.length === 0) continue;
    out.push({ prefix, command, rawArgs, raw, index: m.index });
  }
  return out;
}
