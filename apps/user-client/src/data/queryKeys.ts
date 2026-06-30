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
  libraries: ['libraries'] as const,
  library: (id: string) => ['libraries', id] as const,
  documents: (libraryId: string) => ['documents', 'library', libraryId] as const,
  document: (id: string) => ['documents', 'item', id] as const,
  documentCounts: ['documents', 'counts'] as const,
  mcpServers: ['mcp-servers'] as const,
  memory: (personaId: string) => ['memory', personaId] as const,
  memoryJournal: (personaId: string, state: 'uncommitted' | 'committed' | 'archived') =>
    ['memory', personaId, 'journal', state] as const,
  memoryUncommittedCount: (personaId: string) =>
    ['memory', personaId, 'journal', 'uncommitted', 'count'] as const,
  memoryCommitted: (personaId: string) => ['memory', personaId, 'journal', 'committed'] as const,
  memoryBody: (personaId: string) => ['memory', personaId, 'body'] as const,
  memoryBodyVersions: (personaId: string) => ['memory', personaId, 'body', 'versions'] as const,
  unextractedCount: (chatId: string) => ['memory', 'unextracted', chatId] as const,
  compaction: (chatId: string) => ['compaction', chatId] as const,
  seedTemplates: ['seed-templates'] as const,
  seedTemplate: (id: string) => ['seed-templates', id] as const,
};
