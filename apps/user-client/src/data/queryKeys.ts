// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Canonical query keys for TanStack Query caches over Dexie. Keep these
 * stable — invalidation across modules relies on referential equality of
 * the leading segment.
 */
export const QK = {
  settings: ['settings'] as const,
  personas: ['personas'] as const,
  persona: (id: string) => ['personas', id] as const,
  providers: ['providers'] as const,
  credential: (id: string) => ['providers', 'credential', id] as const,
  mindspaces: ['mindspaces'] as const,
  chats: ['chats'] as const,
  chat: (id: string) => ['chats', id] as const,
  bookmarks: ['bookmarks'] as const,
};
