// SPDX-License-Identifier: AGPL-3.0-only

/**
 * localStorage helpers for lazy-chat cockpit input drafts.
 *
 * Keyed per persona-id (one in-progress lazy chat per persona at most).
 * Chat-mode drafts persist via `ChatRow.draftInput` in Dexie; only the
 * lazy-mode case needs an out-of-band store because there is no ChatRow
 * yet.
 */

const PREFIX = 'cockpit-draft-new:';

function key(personaId: string): string {
  return `${PREFIX}${personaId}`;
}

export function loadLazyDraft(personaId: string): string {
  return localStorage.getItem(key(personaId)) ?? '';
}

export function saveLazyDraft(personaId: string, text: string): void {
  localStorage.setItem(key(personaId), text);
}

export function clearLazyDraft(personaId: string): void {
  localStorage.removeItem(key(personaId));
}
