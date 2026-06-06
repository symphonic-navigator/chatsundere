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
  personaAvatar: (id: string) => ['persona-avatar', id] as const,
  attachmentsPending: (chatId: string) => ['attachments', 'pending', chatId] as const,
  attachmentsForMessage: (messageId: string) => ['attachments', 'message', messageId] as const,
  chatArtefacts: (chatId: string) => ['artefacts', 'chat', chatId] as const,
  artefact: (id: string) => ['artefacts', 'item', id] as const,
  allArtefacts: ['artefacts', 'all'] as const,
};
