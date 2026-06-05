// SPDX-License-Identifier: AGPL-3.0-only
import type { ChatRow } from '../boot/client-data-db.js';
import { fallbackTitle } from './title-generator.js';

/**
 * Resolve a chat's user-facing title.
 *
 * - `chat.title === null` → "New chat — D MMM, HH:mm" fallback derived from
 *   `chat.createdAt`. This is the "no title yet" state (brand-new chat
 *   before title-gen, or user manually cleared the title).
 * - Any non-null string → return as-is, including the technically-possible
 *   empty string. `sanitiseTitle` never produces empty, so this path is
 *   defensive only.
 */
export function displayTitle(chat: ChatRow): string {
  return chat.title ?? fallbackTitle(chat.createdAt);
}
