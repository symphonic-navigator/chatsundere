// SPDX-License-Identifier: LGPL-3.0-only
import { NSFW_PROMPT, TONALITY_PROMPT } from './identity/chatsundere-identity.js';

/** Content-axis unlocker segments for craft/subagent system prompts (not full chat composition).
 *  Order mirrors Band-1: tonality → nsfw → global. Empty segments omitted. */
export function buildContentAxisPrompt(parts: {
  nsfwEnabled: boolean;
  tonalityEnabled: boolean;
  globalInstructions: string;
}): string {
  const segs: string[] = [];
  if (parts.tonalityEnabled) segs.push(TONALITY_PROMPT);
  if (parts.nsfwEnabled) segs.push(NSFW_PROMPT);
  const global = parts.globalInstructions.trim();
  if (global.length > 0) segs.push(global);
  return segs.join('\n\n');
}
